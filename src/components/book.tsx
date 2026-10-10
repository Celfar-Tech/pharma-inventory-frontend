// components/book.tsx
//
// The "Order Book" — a lightweight planning list of medicines the user intends
// to order later. Medicine names are auto-suggested from the same catalogue
// lookup the rest of the app uses (`getMedicineByName`), and picking a
// suggestion auto-fills its composition (plus manufacturer and pack size).
//
// Persistence is handled by `services/book.ts`; the page itself never touches
// the API directly.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBook,
  IconBuildingStore,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconDeviceFloppy,
  IconEdit,
  IconFlask,
  IconHistory,
  IconMail,
  IconMessageCircle,
  IconNotebook,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconTruck,
  IconX,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { debounce } from '../utils/debounce';
import { getMedicineByName, type Medicine } from '../services/medicine';
import {
  clearBookEntries,
  getBookEntries,
  getBookHistory,
  getLedgerItems,
  placeOrderBookEntries,
  removeBookEntry,
  updateBookEntry,
  upsertBookEntry,
  type OrderBookEntry,
  type OrderBookInput,
  type OrderHistoryEntry,
  type OrderLedger,
} from '../services/book';
import styles from './book.module.css';

/** How long the medicine search waits for the user to stop typing (ms). */
const SEARCH_DEBOUNCE_MS = 400;

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const formatCurrency = (value: number): string =>
  currencyFormatter.format(Number.isFinite(value) ? value : 0);

/** Renders a price, falling back to an em dash while it is still undecided. */
const formatPrice = (value: number): string => (value > 0 ? formatCurrency(value) : '—');

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Renders an ISO timestamp as a short local date (or blank when invalid). */
const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

interface BookFormState {
  name: string;
  composition: string;
  manufacturer: string;
  packSize: string;
  quantity: number | string;
  price: number | string;
  remark: string;
}

const EMPTY_FORM: BookFormState = {
  name: '',
  composition: '',
  manufacturer: '',
  packSize: '',
  quantity: 1,
  price: '',
  remark: '',
};

/** Load state of one expandable order-history row. */
type LedgerItemsState =
  | { status: 'loading' }
  | { status: 'loaded'; items: OrderHistoryEntry[] }
  | { status: 'error'; message: string };

export default function BookPage() {
  // --- Data ----------------------------------------------------------------
  const [entries, setEntries] = useState<OrderBookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Selection & order history ------------------------------------------
  const [history, setHistory] = useState<OrderLedger[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<'list' | 'history'>('list');
  const [orderOpened, setOrderOpened] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierValidationAttempted, setSupplierValidationAttempted] = useState(false);

  // --- Order history expansion --------------------------------------------
  // The history list carries order summaries only. A ledger's medicines are
  // fetched the first time its row is expanded and then kept for the life of
  // the page, so repeated expand/collapse never re-hits the API. The two refs
  // guard that cache: `loadedLedgersRef` marks the ledgers already fetched and
  // `inflightLedgersRef` de-dupes concurrent requests for the same row.
  const [expandedLedgers, setExpandedLedgers] = useState<Set<string>>(() => new Set());
  const [ledgerItems, setLedgerItems] = useState<Record<string, LedgerItemsState>>({});
  const loadedLedgersRef = useRef<Set<string>>(new Set());
  const inflightLedgersRef = useRef<Set<string>>(new Set());

  // --- Form ----------------------------------------------------------------
  const [form, setForm] = useState<BookFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  // --- Medicine autocomplete ----------------------------------------------
  const [suggestions, setSuggestions] = useState<Medicine[]>([]);
  const [searching, setSearching] = useState(false);
  // The selected catalogue item, tracked in a ref because it must be readable
  // synchronously: `onOptionSubmit` runs immediately before the matching
  // `onChange`, and state would not have flushed yet at that point.
  const selectedRef = useRef<Medicine | null>(null);

  // --- Confirmation dialogs ------------------------------------------------
  const [pendingDelete, setPendingDelete] = useState<OrderBookEntry | null>(null);
  const [clearOpened, setClearOpened] = useState(false);

  const formRef = useRef<HTMLDivElement>(null);
  const medicineNameRef = useRef<HTMLInputElement | null>(null);

  /**
   * Debounced catalogue search. Created once; `cancel()` is called on unmount
   * and whenever a selection is made so a late response cannot repopulate a
   * dropdown the user has already moved on from.
   */
  const runSearch = useMemo(
    () =>
      debounce((term: string) => {
        if (!term.trim()) {
          setSuggestions([]);
          setSearching(false);
          return;
        }

        setSearching(true);
        getMedicineByName(term)
          .then((response) => setSuggestions(Array.isArray(response.data) ? response.data : []))
          .catch(() => setSuggestions([]))
          .finally(() => setSearching(false));
      }, SEARCH_DEBOUNCE_MS),
    []
  );

  useEffect(() => () => runSearch.cancel(), [runSearch]);

  // Load the book and its history from the API once on mount.
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [nextEntries, nextHistory] = await Promise.all([
          getBookEntries(),
          getBookHistory(),
        ]);
        if (!active) return;
        setEntries(nextEntries);
        setSelectedIds(new Set(nextEntries.map((entry) => entry.id)));
        setHistory(nextHistory);
      } catch (error) {
        if (!active) return;
        notifications.show({
          title: 'Could not load order book',
          message: error instanceof Error ? error.message : 'Please try again.',
          color: 'red',
          icon: <IconAlertCircle size={18} />,
        });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // --- Derived -------------------------------------------------------------
  const editingEntry = useMemo(
    () => (editingId ? entries.find((entry) => entry.id === editingId) ?? null : null),
    [editingId, entries]
  );

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, entry) => {
          acc.items += 1;
          acc.quantity += entry.quantity;
          acc.cost += entry.quantity * entry.price;
          return acc;
        },
        { items: 0, quantity: 0, cost: 0 }
      ),
    [entries]
  );

  /** Mantine requires unique option values, so de-dupe by sku defensively. */
  const autocompleteData = useMemo(() => {
    const seen = new Set<string>();
    return suggestions.reduce<{ value: string; label: string }[]>((items, medicine) => {
      const name = (medicine.name || '').trim();
      if (!name) return items;

      const value = `sku:${medicine.sku_id}`;
      if (seen.has(value)) return items;

      seen.add(value);
      items.push({ value, label: name });
      return items;
    }, []);
  }, [suggestions]);

  // --- Validation ----------------------------------------------------------
  const isNameValid = form.name.trim().length > 0;
  const isQuantityValid = form.quantity !== '' && Number(form.quantity) > 0;
  const priceValue = form.price === '' ? 0 : Number(form.price);
  const isPriceValid = Number.isFinite(priceValue) && priceValue >= 0;
  const isFormValid = isNameValid && isQuantityValid && isPriceValid;

  // --- Handlers ------------------------------------------------------------
  const resetForm = useCallback(() => {
    runSearch.cancel();
    selectedRef.current = null;
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSubmitted(false);
    setSuggestions([]);
    setSearching(false);
  }, [runSearch]);

  const handleNameChange = useCallback(
    (text: string) => {
      const selected = selectedRef.current;
      const stillSelected = !!selected && selected.name === text;
      if (!stillSelected) selectedRef.current = null;

      // Editing the text away from the picked medicine drops the details that
      // came from the catalogue, so composition can never describe a name the
      // user is no longer looking at.
      setForm((prev) => ({
        ...prev,
        name: text,
        composition: stillSelected ? prev.composition : '',
        manufacturer: stillSelected ? prev.manufacturer : '',
        packSize: stillSelected ? prev.packSize : '',
      }));

      // Picking an option re-fires onChange with the resolved name; searching
      // again would just reopen the dropdown over the selection.
      if (stillSelected) return;
      runSearch(text);
    },
    [runSearch]
  );

  const handleMedicinePick = useCallback(
    (optionValue: string) => {
      const medicine = suggestions.find((item) => `sku:${item.sku_id}` === optionValue);
      if (!medicine) return;

      runSearch.cancel();
      selectedRef.current = medicine;

      setForm((prev) => ({
        ...prev,
        name: medicine.name,
        composition: medicine.short_composition || '',
        manufacturer: medicine.manufacturer_name || '',
        packSize: medicine.pack_size_label || '',
        price: typeof medicine.price === 'number' ? medicine.price : prev.price,
      }));
    },
    [runSearch, suggestions]
  );

  const startEdit = useCallback(
    (entry: OrderBookEntry) => {
      runSearch.cancel();
      selectedRef.current = null;
      setEditingId(entry.id);
      setSubmitted(false);
      setSuggestions([]);
      setSearching(false);
      setForm({
        name: entry.name,
        composition: entry.composition,
        manufacturer: entry.manufacturer,
        packSize: entry.packSize,
        quantity: entry.quantity,
        price: entry.price > 0 ? entry.price : '',
        remark: entry.remark,
      });

      // The list can be long on phones — bring the form back into view.
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [runSearch]
  );

  // Editing moves focus straight into the medicine name field so the user can
  // retype or pick a different medicine without an extra click. `preventScroll`
  // keeps the smooth scroll above in charge of positioning on small screens.
  useEffect(() => {
    if (editingId) medicineNameRef.current?.focus({ preventScroll: true });
  }, [editingId]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitted(true);

      if (!isFormValid) {
        notifications.show({
          title: 'Missing details',
          message: 'Add a medicine name and a quantity of at least 1.',
          color: 'red',
          icon: <IconAlertCircle size={18} />,
        });
        return;
      }

      const name = form.name.trim();
      // Keep the catalogue id when editing a line the user did not rename, so
      // the entry keeps merging with its own medicine rather than by name.
      const medicineId =
        selectedRef.current?.sku_id ??
        (editingEntry && editingEntry.name === name ? editingEntry.medicineId : null);

      const payload: OrderBookInput = {
        medicineId,
        name,
        manufacturer: form.manufacturer.trim(),
        composition: form.composition.trim(),
        packSize: form.packSize.trim(),
        quantity: Number(form.quantity) || 0,
        price: form.price === '' ? 0 : Number(form.price) || 0,
        remark: form.remark.trim(),
      };

      setSaving(true);
      try {
        if (editingId) {
          const { entries: next } = await updateBookEntry(editingId, payload);
          setEntries(next);
          notifications.show({
            title: 'Line updated',
            message: `${name} was updated in your order book.`,
            color: 'teal',
            icon: <IconCheck size={16} />,
          });
        } else {
          const { entries: next, merged } = await upsertBookEntry(payload);
          setEntries(next);
          notifications.show({
            title: merged ? 'Quantity updated' : 'Added to order book',
            message: merged
              ? `${name} was already on your list — its quantity was increased.`
              : `${name} is now on your order list.`,
            color: 'teal',
            icon: <IconCheck size={16} />,
          });
        }

        resetForm();
      } catch (error) {
        notifications.show({
          title: 'Could not save line',
          message: error instanceof Error ? error.message : 'Please try again.',
          color: 'red',
          icon: <IconAlertCircle size={18} />,
        });
      } finally {
        setSaving(false);
      }
    },
    [editingEntry, editingId, form, isFormValid, resetForm]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete) return;

    const { id, name } = pendingDelete;
    setSaving(true);
    try {
      const next = await removeBookEntry(id);
      setEntries(next);
      setSelectedIds((prev) => {
        const nextIds = new Set(prev);
        nextIds.delete(id);
        return nextIds;
      });
      setPendingDelete(null);

      notifications.show({
        title: 'Removed from book',
        message: `${name} was removed from your order book.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Could not remove line',
        message: error instanceof Error ? error.message : 'Please try again.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setSaving(false);
    }
  }, [pendingDelete]);

  const handleClearConfirm = useCallback(async () => {
    setSaving(true);
    try {
      await clearBookEntries();
      setEntries([]);
      setSelectedIds(new Set());
      setClearOpened(false);

      notifications.show({
        title: 'Order book cleared',
        message: 'All planned medicines were removed.',
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Could not clear order book',
        message: error instanceof Error ? error.message : 'Please try again.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setSaving(false);
    }
  }, []);

  // --- Selection & order history ------------------------------------------
  const allSelected = entries.length > 0 && selectedIds.size === entries.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === entries.length ? new Set() : new Set(entries.map((entry) => entry.id))
    );
  }, [entries]);

  /**
   * Fetches one order's medicines, at most once.
   *
   * A ledger already loaded is served from state and a ledger already being
   * fetched is left alone, so expanding a row repeatedly — or collapsing and
   * re-expanding it — can never stack duplicate backend calls. A failed load is
   * intentionally not cached, so re-expanding (or pressing Retry) tries again.
   */
  const loadLedgerItems = useCallback(async (ledgerId: string) => {
    if (loadedLedgersRef.current.has(ledgerId) || inflightLedgersRef.current.has(ledgerId)) {
      return;
    }

    inflightLedgersRef.current.add(ledgerId);
    setLedgerItems((prev) => ({ ...prev, [ledgerId]: { status: 'loading' } }));

    try {
      const { items } = await getLedgerItems(ledgerId);
      loadedLedgersRef.current.add(ledgerId);
      setLedgerItems((prev) => ({ ...prev, [ledgerId]: { status: 'loaded', items } }));
    } catch (error) {
      setLedgerItems((prev) => ({
        ...prev,
        [ledgerId]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Please try again.',
        },
      }));
    } finally {
      inflightLedgersRef.current.delete(ledgerId);
    }
  }, []);

  const toggleLedger = useCallback(
    (ledgerId: string) => {
      setExpandedLedgers((prev) => {
        const next = new Set(prev);
        if (next.has(ledgerId)) next.delete(ledgerId);
        else next.add(ledgerId);
        return next;
      });

      // Safe on collapse too: it is a no-op once the row has been fetched.
      void loadLedgerItems(ledgerId);
    },
    [loadLedgerItems]
  );

  const validateSupplierDetails = useCallback(() => {
    setSupplierValidationAttempted(true);
    const trimmedName = supplierName.trim();
    const trimmedEmail = supplierEmail.trim();

    return trimmedName.length > 0 && isValidEmail(trimmedEmail);
  }, [supplierEmail, supplierName]);

  const handleOrderOpen = useCallback(() => {
    if (validateSupplierDetails()) setOrderOpened(true);
  }, [validateSupplierDetails]);

  const handleOrderConfirm = useCallback(async () => {
    if (!validateSupplierDetails()) return;

    setSaving(true);
    try {
      const { entries: next, history: nextHistory, placed } = await placeOrderBookEntries({
        ids: [...selectedIds],
        supplierName: supplierName.trim(),
        supplierEmail: supplierEmail.trim(),
      });
      setEntries(next);
      setHistory(nextHistory);
      setSelectedIds(new Set());
      setOrderOpened(false);

      notifications.show({
        title: 'Order sent',
        message: `${placed.length} ${placed.length === 1 ? 'medicine was' : 'medicines were'} sent to the supplier.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Could not send order',
        message: error instanceof Error ? error.message : 'Please try again.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setSaving(false);
    }
  }, [selectedIds, supplierEmail, supplierName, validateSupplierDetails]);

  return (
    <Box>
      {/* ---- Page header ------------------------------------------------- */}
      <Flex justify="space-between" align="flex-start" gap="md" wrap="wrap" mb={{ base: 'md', md: 'lg' }}>
        <Box>
          <Title order={2} fz={{ base: 'h3', sm: 'h2' }}>
            Order Book
          </Title>
          <Text c="dimmed" size="sm">
            Keep track of the medicines you want to order next.
          </Text>
        </Box>

        <Group gap="xs">
          <Badge
            variant="light"
            color="blue"
            size="lg"
            radius="md"
            leftSection={<IconNotebook size={13} />}
          >
            {totals.items} {totals.items === 1 ? 'item' : 'items'}
          </Badge>
          <Badge variant="light" color="cyan" size="lg" radius="md">
            Est. {formatCurrency(totals.cost)}
          </Badge>
          {entries.length > 0 && (
            <Button
              variant="subtle"
              color="red"
              size="sm"
              leftSection={<IconTrash size={15} />}
              onClick={() => setClearOpened(true)}
              h={{ base: 40, sm: 32 }}
            >
              Clear all
            </Button>
          )}
        </Group>
      </Flex>

      {/* ---- Form + list -------------------------------------------------- */}
      <Flex direction={{ base: 'column', lg: 'row' }} gap="lg" align="flex-start">
        {/* Add / edit form */}
        <Box ref={formRef} w={{ base: '100%', lg: 400 }} style={{ flexShrink: 0 }}>
          <Paper p="lg" radius="lg" withBorder shadow="xs">
            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <Group gap="xs" wrap="nowrap">
                  <ThemeIcon variant="light" color="blue" size="lg" radius="md">
                    {editingId ? <IconEdit size={18} /> : <IconDeviceFloppy size={18} />}
                  </ThemeIcon>
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={700} fz="sm">
                      {editingId ? 'Edit line' : 'Add a medicine'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {editingId ? 'Update the details and save.' : 'Type a name, then pick a suggestion.'}
                    </Text>
                  </Box>
                </Group>

                <Autocomplete
                  ref={medicineNameRef}
                  label="Medicine name"
                  placeholder="Start typing medicine name"
                  required
                  value={form.name}
                  onChange={handleNameChange}
                  onOptionSubmit={handleMedicinePick}
                  data={autocompleteData}
                  rightSection={searching ? <Loader size="xs" /> : null}
                  rightSectionWidth={36}
                  error={submitted && !isNameValid ? 'Medicine name is required' : null}
                  renderOption={({ option }) => {
                    const medicine = suggestions.find(
                      (item) => `sku:${item.sku_id}` === option.value
                    );
                    return (
                      <Group justify="space-between" gap="md" wrap="nowrap">
                        <Text size="sm" fw={500} className={styles.truncate}>
                          {medicine?.name ?? option.value}
                        </Text>
                        {medicine?.manufacturer_name && (
                          <Text size="xs" c="dimmed" className={styles.truncate}>
                            {medicine.manufacturer_name}
                          </Text>
                        )}
                      </Group>
                    );
                  }}
                />

                <TextInput
                  label="Composition"
                  placeholder="Salt/Composition (optional)"
                  value={form.composition}
                  readOnly={Boolean(selectedRef.current)}
                  onChange={(event) => {
                    const composition = event.currentTarget.value;
                    setForm((prev) => ({ ...prev, composition }));
                  }}
                />

                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                  <TextInput
                    label="Manufacturer"
                    placeholder="Manufacturer (optional)"
                    value={form.manufacturer}
                    readOnly={Boolean(selectedRef.current)}
                    onChange={(event) => {
                      const manufacturer = event.currentTarget.value;
                      setForm((prev) => ({ ...prev, manufacturer }));
                    }}
                  />
                  <TextInput
                    label="Pack size"
                    value={form.packSize}
                    placeholder="Pack size (optional)"
                    readOnly={Boolean(selectedRef.current)}
                    onChange={(event) => {
                      const packSize = event.currentTarget.value;
                      setForm((prev) => ({ ...prev, packSize }));
                    }}
                  />
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                  <NumberInput
                    label="Quantity"
                    required
                    min={1}
                    step={1}
                    decimalScale={0}
                    clampBehavior="strict"
                    value={form.quantity}
                    onChange={(value) => setForm((prev) => ({ ...prev, quantity: value }))}
                    error={submitted && !isQuantityValid ? 'Min. 1' : null}
                  />
                  <NumberInput
                    label="Expected price"
                    prefix="₹"
                    thousandSeparator=","
                    decimalScale={2}
                    min={0}
                    allowNegative={false}
                    clampBehavior="strict"
                    hideControls
                    placeholder="0.00"
                    value={form.price}
                    onChange={(value) => setForm((prev) => ({ ...prev, price: value }))}
                    error={submitted && !isPriceValid ? 'Cannot be negative' : null}
                  />
                </SimpleGrid>

                <Textarea
                  label="Remark"
                  placeholder="Additional notes (optional)"
                  autosize
                  minRows={2}
                  maxRows={4}
                  value={form.remark}
                  onChange={(event) => {
                    const remark = event.currentTarget.value;
                    setForm((prev) => ({ ...prev, remark }));
                  }}
                />

                <Group gap="sm" grow>
                  {editingId && (
                    <Button
                      type="button"
                      variant="default"
                      onClick={resetForm}
                      leftSection={<IconX size={16} />}
                      h={{ base: 44, sm: 40 }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="submit"
                    color="blue"
                    loading={saving}
                    onClick={() => medicineNameRef.current?.focus()}
                    leftSection={editingId ? <IconDeviceFloppy size={16} /> : <IconPlus size={16} />}
                    h={{ base: 44, sm: 40 }}
                  >
                    {editingId ? 'Save changes' : 'Add to order book'}
                  </Button>
                </Group>
              </Stack>
            </form>
          </Paper>
        </Box>

        {/* Planned medicines */}
        <Box w="100%" style={{ flex: 1, minWidth: 0 }}>
          <Paper p="lg" radius="lg" withBorder shadow="xs">
            {/* ---- Panel toolbar: identity, view switch, supplier ------ */}
            <div className={styles.toolbar}>
              <div className={styles.toolbarHeader}>
                <Group gap="sm" align="center" wrap="nowrap" className={styles.toolbarIdentity}>
                  <span className={styles.toolbarIcon}>
                    {view === 'history' ? <IconHistory size={18} /> : <IconNotebook size={18} />}
                  </span>
                  <div className={styles.toolbarTitle}>
                    <Text fw={700} lh={1.2}>
                      {view === 'history' ? 'Order history' : 'Your list'}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {view === 'history'
                        ? `${history.length} ${history.length === 1 ? 'order' : 'orders'} placed`
                        : entries.length === 0
                          ? 'Nothing planned yet'
                          : `${totals.items} ${totals.items === 1 ? 'item' : 'items'} · ${selectedIds.size} selected`}
                    </Text>
                  </div>
                </Group>

                <SegmentedControl
                  size="xs"
                  radius="md"
                  value={view}
                  onChange={(value) => setView(value as 'list' | 'history')}
                  data={[
                    {
                      value: 'list',
                      label: (
                        <span className={styles.segmentLabel}>
                          List
                          <span className={styles.segmentCount}>{entries.length}</span>
                        </span>
                      ),
                    },
                    {
                      value: 'history',
                      label: (
                        <span className={styles.segmentLabel}>
                          History
                          <span className={styles.segmentCount}>{history.length}</span>
                        </span>
                      ),
                    },
                  ]}
                />
              </div>

              {view === 'list' && entries.length > 0 && (
                <div className={styles.supplierStrip}>
                  <span className={styles.supplierCaption}>
                    <IconTruck size={15} />
                    <Text size="xs" fw={600}>
                      Supplier
                    </Text>
                  </span>

                  <TextInput
                    className={styles.supplierField}
                    size="xs"
                    radius="md"
                    placeholder="Supplier name"
                    aria-label="Supplier name"
                    leftSection={<IconBuildingStore size={14} />}
                    leftSectionWidth={30}
                    value={supplierName}
                    onChange={(event) => setSupplierName(event.currentTarget.value)}
                    required
                    error={
                      supplierValidationAttempted && !supplierName.trim()
                        ? 'Supplier name is required.'
                        : undefined
                    }
                  />
                  <TextInput
                    className={styles.supplierField}
                    size="xs"
                    radius="md"
                    type="email"
                    placeholder="Email"
                    aria-label="Supplier email"
                    leftSection={<IconMail size={14} />}
                    leftSectionWidth={30}
                    value={supplierEmail}
                    onChange={(event) => setSupplierEmail(event.currentTarget.value)}
                    required
                    error={
                      supplierValidationAttempted
                        ? !supplierEmail.trim()
                          ? 'Supplier email is required.'
                          : !isValidEmail(supplierEmail.trim())
                            ? 'Enter a valid email address.'
                            : undefined
                        : undefined
                    }
                  />

                  <Button
                    className={styles.supplierAction}
                    size="xs"
                    radius="md"
                    variant="gradient"
                    gradient={{ from: 'blue', to: 'cyan', deg: 135 }}
                    leftSection={<IconCircleCheck size={14} />}
                    onClick={handleOrderOpen}
                    disabled={selectedIds.size === 0}
                  >
                    {selectedIds.size > 0
                      ? `Send Order (${selectedIds.size})`
                      : 'Send Order'}
                  </Button>
                </div>
              )}
            </div>

            {loading ? (
              <Box className={styles.empty} ta="center">
                <Flex justify="center">
                  <Loader size="md" />
                </Flex>
                <Text size="sm" c="dimmed" mt="sm">
                  Loading your order book…
                </Text>
              </Box>
            ) : view === 'history' ? (
              history.length === 0 ? (
                <Box className={styles.empty} ta="center">
                  <Flex justify="center">
                    <ThemeIcon variant="light" color="blue" size={54} radius="xl">
                      <IconHistory size={28} />
                    </ThemeIcon>
                  </Flex>
                  <Text fw={600} mt="sm">
                    No orders placed yet
                  </Text>
                  <Text size="sm" c="dimmed" maw={360} mx="auto" mt={4}>
                    Medicines you send orders for will appear here.
                  </Text>
                </Box>
              ) : (
                <Box className={styles.scrollList}>
                  <Stack gap="sm">
                    {history.map((ledger) => {
                      const expanded = expandedLedgers.has(ledger.ledgerId);
                      const detail = ledgerItems[ledger.ledgerId];

                      return (
                        <Box key={ledger.ledgerId} className={styles.ledgerCard}>
                          <button
                            type="button"
                            className={styles.ledgerToggle}
                            onClick={() => toggleLedger(ledger.ledgerId)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} order ${ledger.ledgerId}`}
                          >
                            <IconChevronRight
                              size={16}
                              className={styles.ledgerChevron}
                              data-expanded={expanded || undefined}
                            />

                            <span className={styles.ledgerSummary}>
                              <span className={styles.ledgerSupplier}>
                                {ledger.supplierName || 'Supplier not recorded'}
                              </span>
                              <span className={styles.ledgerMeta}>
                                {formatDate(ledger.orderedAt)} · {ledger.itemCount}{' '}
                                {ledger.itemCount === 1 ? 'item' : 'items'} ·{' '}
                                {formatCurrency(ledger.approxCost)}
                              </span>
                            </span>

                            <Badge
                              variant="light"
                              color="blue"
                              radius="sm"
                              size="sm"
                              className={styles.ledgerBadge}
                            >
                              {ledger.ledgerId}
                            </Badge>
                          </button>

                          {expanded && (
                            <div className={styles.ledgerPanel}>
                              {(!detail || detail.status === 'loading') && (
                                <Group gap="xs" justify="center" py={6}>
                                  <Loader size="xs" />
                                  <Text size="xs" c="dimmed">
                                    Loading medicines…
                                  </Text>
                                </Group>
                              )}

                              {detail?.status === 'error' && (
                                <Group justify="space-between" gap="xs" wrap="nowrap">
                                  <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                                    <IconAlertCircle size={15} color="var(--mantine-color-red-6)" />
                                    <Text size="xs" c="red.7">
                                      {detail.message}
                                    </Text>
                                  </Group>
                                  <Button
                                    size="compact-xs"
                                    variant="light"
                                    color="red"
                                    leftSection={<IconRefresh size={13} />}
                                    onClick={() => void loadLedgerItems(ledger.ledgerId)}
                                  >
                                    Retry
                                  </Button>
                                </Group>
                              )}

                              {detail?.status === 'loaded' && detail.items.length === 0 && (
                                <Text size="xs" c="dimmed" ta="center" py={6}>
                                  No medicines recorded for this order.
                                </Text>
                              )}

                              {detail?.status === 'loaded' && detail.items.length > 0 && (
                                <Box className={styles.ledgerTableScroll}>
                                  <Table
                                    className={styles.ledgerTable}
                                    fz="sm"
                                    horizontalSpacing="sm"
                                    verticalSpacing={4}
                                  >
                                    <Table.Thead>
                                      <Table.Tr>
                                        <Table.Th>Medicine</Table.Th>
                                        <Table.Th>Qty × price</Table.Th>
                                        <Table.Th ta="right">Est. total</Table.Th>
                                      </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                      {detail.items.map((item) => (
                                        <Table.Tr key={item.id}>
                                          <Table.Td>
                                            <Text fw={600} fz="sm">{item.name}</Text>
                                          </Table.Td>
                                          <Table.Td>
                                            {item.quantity} × {formatPrice(item.price)}
                                          </Table.Td>
                                          <Table.Td ta="right">
                                            <Text fw={700} c="blue.7" fz="sm">
                                              {formatPrice(item.quantity * item.price)}
                                            </Text>
                                          </Table.Td>
                                        </Table.Tr>
                                      ))}
                                    </Table.Tbody>
                                  </Table>
                                </Box>
                              )}
                            </div>
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              )
            ) : entries.length === 0 ? (
              <Box className={styles.empty} ta="center">
                <Flex justify="center">
                  <ThemeIcon variant="light" color="blue" size={54} radius="xl">
                    <IconBook size={28} />
                  </ThemeIcon>
                </Flex>
                <Text fw={600} mt="sm">
                  Your order book is empty
                </Text>
                <Text size="sm" c="dimmed" maw={360} mx="auto" mt={4}>
                  Add the medicines you plan to buy later — start typing a name in the form.
                </Text>
              </Box>
            ) : (
              <Stack gap="sm" className={styles.scrollList}>
                <Group justify="space-between" gap="xs">
                  <Checkbox
                    label={allSelected ? 'Deselect all' : 'Select all'}
                    size="xs"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleSelectAll}
                  />

                </Group>

                {entries.map((entry) => (
                  <Box key={entry.id} className={styles.entry}>
                    <Box className={styles.entryMain}>
                      <Group gap="sm" wrap="nowrap" align="flex-start">
                        <Checkbox
                          mt={2}
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelect(entry.id)}
                          aria-label={`Select ${entry.name}`}
                        />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Group gap="xs" wrap="wrap">
                            <Text fw={600} fz="sm">
                              {entry.name}
                            </Text>
                            {entry.packSize && (
                              <Badge size="xs" variant="light" color="blue" radius="sm">
                                {entry.packSize}
                              </Badge>
                            )}
                            {entry.manufacturer && (
                              <Badge size="xs" variant="light" color="cyan" radius="sm">
                                {entry.manufacturer}
                              </Badge>
                            )}
                          </Group>


                          {(entry.composition || entry.remark) && (
                            <Group gap={12} mt={6} wrap="nowrap" align="flex-start">

                              {/* Composition Field */}
                              {entry.composition && (
                                <Group gap={6} wrap="nowrap" align="center" style={{ flex: '0 1 auto', minWidth: 0 }}>
                                  <IconFlask size={14} color="#0891b2" style={{ flexShrink: 0 }} />
                                  <Text size="xs" c="dimmed" fw={500} className={styles.truncate}>
                                    {entry.composition}
                                  </Text>
                                </Group>
                              )}

                              {/* Simple Separator (Only shows if BOTH fields exist) */}
                              {entry.composition && entry.remark && (
                                <Text size="xs" c="gray.5" style={{ flexShrink: 0 }}>
                                  |
                                </Text>
                              )}

                              {/* Remark Field */}
                              {entry.remark && (
                                <Group gap={6} wrap="nowrap" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
                                  <IconMessageCircle size={14} color="#8b5cf6" style={{ flexShrink: 0, marginTop: 2 }} />
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                    fs="italic"
                                    className={styles.remark}
                                    style={{ flex: 1, minWidth: 0 }}
                                  >
                                    “{entry.remark}”
                                  </Text>
                                </Group>
                              )}

                            </Group>
                          )}
                        </Box>
                      </Group>
                    </Box>

                    <Group className={styles.entryAside} gap={12} wrap="wrap">
                      <Stack gap={0} miw={84}>
                        <Text size="xs" c="dimmed">
                          Qty × price
                        </Text>
                        <Text size="sm" fw={600}>
                          {entry.quantity} × {formatPrice(entry.price)}
                        </Text>
                      </Stack>

                      <Stack gap={0} miw={92}>
                        <Text size="xs" c="dimmed">
                          Est. total
                        </Text>
                        <Text size="sm" fw={700} c="blue.7">
                          {formatPrice(entry.quantity * entry.price)}
                        </Text>
                      </Stack>

                      <Group gap={4} wrap="nowrap">
                        <Tooltip label="Edit">
                          <ActionIcon
                            variant="light"
                            color="blue"
                            radius="md"
                            size="lg"
                            onClick={() => startEdit(entry)}
                            aria-label={`Edit ${entry.name}`}
                            data-touch-target
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Remove">
                          <ActionIcon
                            variant="light"
                            color="red"
                            radius="md"
                            size="lg"
                            onClick={() => setPendingDelete(entry)}
                            aria-label={`Remove ${entry.name}`}
                            data-touch-target
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>
        </Box>
      </Flex>

      {/* ---- Confirm: remove one line ------------------------------------- */}
      <Modal
        opened={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={
          <Text fw={700} c="red.7">
            Warning: Permanent Action
          </Text>
        }
        centered
        size="sm"
        radius="md"
      >
        <Stack gap="lg">
          <Text size="sm">
            Remove{' '}
            <Text component="span" fw={600}>
              {pendingDelete?.name}
            </Text>{' '}
            from your order book? This cannot be undone.
          </Text>
          <Flex direction={{ base: 'column-reverse', xs: 'row' }} justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setPendingDelete(null)}
              h={{ base: 44, sm: 36 }}
              w={{ base: '100%', sm: 'auto' }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleDeleteConfirm}
              loading={saving}
              leftSection={<IconTrash size={15} />}
              h={{ base: 44, sm: 36 }}
              w={{ base: '100%', sm: 'auto' }}
            >
              Remove
            </Button>
          </Flex>
        </Stack>
      </Modal>

      {/* ---- Confirm: clear everything ------------------------------------ */}
      <Modal
        opened={clearOpened}
        onClose={() => setClearOpened(false)}
        title={
          <Text fw={700} c="red.7">
            Warning: Permanent Action
          </Text>
        }
        centered
        size="sm"
        radius="md"
      >
        <Stack gap="lg">
          <Text size="sm">
            Remove all {totals.items} {totals.items === 1 ? 'line' : 'lines'} from your order book?
            This cannot be undone.
          </Text>
          <Flex direction={{ base: 'column-reverse', xs: 'row' }} justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setClearOpened(false)}
              h={{ base: 44, sm: 36 }}
              w={{ base: '100%', sm: 'auto' }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleClearConfirm}
              loading={saving}
              leftSection={<IconTrash size={15} />}
              h={{ base: 44, sm: 36 }}
              w={{ base: '100%', sm: 'auto' }}
            >
              Clear all
            </Button>
          </Flex>
        </Stack>
      </Modal>
      {/* ---- Confirm: mark selected as ordered ---------------------------- */}
      <Modal
        opened={orderOpened}
        onClose={() => setOrderOpened(false)}
        title={<Text fw={700}>Send Order?</Text>}
        centered
        size="sm"
        radius="md"
      >
        <Stack gap="lg">
          <Text size="sm">
           Supplier will be alerted via mail for the selected items.
          </Text>
          <Flex direction={{ base: 'column-reverse', xs: 'row' }} justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setOrderOpened(false)}
              h={{ base: 44, sm: 36 }}
              w={{ base: '100%', sm: 'auto' }}
            >
              Cancel
            </Button>
            <Button
              color="green"
              onClick={handleOrderConfirm}
              loading={saving}
              leftSection={<IconCircleCheck size={15} />}
              h={{ base: 44, sm: 36 }}
              w={{ base: '100%', sm: 'auto' }}
            >
Send            </Button>
          </Flex>
        </Stack>
      </Modal>
    </Box>
  );
}
