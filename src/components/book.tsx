// components/book.tsx
//
// The "Order Book" — a lightweight planning list of medicines the user intends
// to order later. Medicine names are auto-suggested from the same catalogue
// lookup the rest of the app uses (`getMedicineByName`), and picking a
// suggestion auto-fills its composition (plus manufacturer and pack size).
//
// Persistence is client-side for now (see `services/book.ts`); the page itself
// never touches storage APIs directly so the swap to a REST backend later is a
// one-file change.

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
  SimpleGrid,
  Stack,
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
  IconCheck,
  IconCircleCheck,
  IconDeviceFloppy,
  IconEdit,
  IconFlask,
  IconHistory,
  IconNotebook,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { debounce } from '../utils/debounce';
import { getMedicineByName, type Medicine } from '../services/medicine';
import {
  clearBookEntries,
  getBookEntries,
  getBookHistory,
  placeOrderBookEntries,
  removeBookEntry,
  updateBookEntry,
  upsertBookEntry,
  type OrderBookEntry,
  type OrderBookInput,
  type OrderHistoryEntry,
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

export default function BookPage() {
  // --- Data ----------------------------------------------------------------
  const [entries, setEntries] = useState<OrderBookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Selection & order history ------------------------------------------
  const [history, setHistory] = useState<OrderHistoryEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<'list' | 'history'>('list');
  const [orderOpened, setOrderOpened] = useState(false);

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

  const handleOrderConfirm = useCallback(async () => {
    setSaving(true);
    try {
      const { entries: next, history: nextHistory, placed } = await placeOrderBookEntries([
        ...selectedIds,
      ]);
      setEntries(next);
      setHistory(nextHistory);
      setSelectedIds(new Set());
      setOrderOpened(false);

      notifications.show({
        title: 'Marked as ordered',
        message: `${placed.length} ${placed.length === 1 ? 'medicine was' : 'medicines were'} moved to your order history.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Could not mark as ordered',
        message: error instanceof Error ? error.message : 'Please try again.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setSaving(false);
    }
  }, [selectedIds]);

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
                  label="Medicine name"
                  placeholder="Start typing a medicine…"
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
                  description="Auto-filled from the selected medicine"
                  value={form.composition}
                  placeholder="Pick a suggestion to auto-fill"
                   onChange={(event) => {
                    const composition = event.currentTarget.value;
                    setForm((prev) => ({ ...prev, composition }));
                  }}
                />

                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                  <TextInput
                    label="Manufacturer"
                    value={form.manufacturer}
                    placeholder="—"
                     onChange={(event) => {
                    const manufacturer = event.currentTarget.value;
                    setForm((prev) => ({ ...prev, manufacturer }));
                  }}
                  />
                  <TextInput
                    label="Pack size"
                    value={form.packSize}
                    placeholder="—"
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
                  placeholder="e.g. order after Diwali · check new batch"
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
            <Group justify="space-between" mb="md" gap="xs">
              <Group gap="xs">
                {view === 'history' ? (
                  <IconHistory size={18} color="#228be6" />
                ) : (
                  <IconNotebook size={18} color="#228be6" />
                )}
                <Text fw={700}>{view === 'history' ? 'Order history' : 'Your list'}</Text>
              </Group>
              <Group gap="xs">
                {view === 'list' && (
                  <Text size="xs" c="dimmed">
                    {totals.items} {totals.items === 1 ? 'line' : 'lines'} · {totals.quantity} units
                  </Text>
                )}
                <Button
                  variant="light"
                  color="gray"
                  size="xs"
                  leftSection={
                    view === 'history' ? <IconNotebook size={14} /> : <IconHistory size={14} />
                  }
                  onClick={() => setView((prev) => (prev === 'history' ? 'list' : 'history'))}
                >
                  {view === 'history' ? 'Back to list' : `History (${history.length})`}
                </Button>
              </Group>
            </Group>

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
                    Medicines you mark as ordered will appear here.
                  </Text>
                </Box>
              ) : (
                <Stack gap="sm">
                  {history.map((entry) => (
                    <Box key={entry.id} className={styles.entry}>
                      <Box className={styles.entryMain}>
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

                        {entry.composition && (
                          <Group gap={6} mt={6} wrap="nowrap" align="center">
                            <IconFlask size={13} color="#0891b2" style={{ flexShrink: 0 }} />
                            <Text size="xs" c="dimmed" className={styles.truncate}>
                              {entry.composition}
                            </Text>
                          </Group>
                        )}
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
                            Ordered on
                          </Text>
                          <Text size="sm" fw={600}>
                            {formatDate(entry.orderedAt)}
                          </Text>
                        </Stack>
                      </Group>
                    </Box>
                  ))}
                </Stack>
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
              <Stack gap="sm">
                <Group justify="space-between" gap="xs">
                  <Checkbox
                    label={allSelected ? 'Deselect all' : 'Select all'}
                    size="xs"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleSelectAll}
                  />
                  {selectedIds.size > 0 && (
                    <Button
                      size="xs"
                      color="green"
                      leftSection={<IconCircleCheck size={14} />}
                      onClick={() => setOrderOpened(true)}
                    >
                      Mark as ordered ({selectedIds.size})
                    </Button>
                  )}
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

                          {entry.composition && (
                            <Group gap={6} mt={6} wrap="nowrap" align="center">
                              <IconFlask size={13} color="#0891b2" style={{ flexShrink: 0 }} />
                              <Text size="xs" c="dimmed" className={styles.truncate}>
                                {entry.composition}
                              </Text>
                            </Group>
                          )}

                          {entry.remark && (
                            <Text size="xs" c="dimmed" fs="italic" mt={6} className={styles.remark}>
                              “{entry.remark}”
                            </Text>
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
        title={<Text fw={700}>Mark as ordered?</Text>}
        centered
        size="sm"
        radius="md"
      >
        <Stack gap="lg">
          <Text size="sm">
            Move {selectedIds.size} selected {selectedIds.size === 1 ? 'medicine' : 'medicines'} to
            your order history? They will be removed from your current list.
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
              Mark as ordered
            </Button>
          </Flex>
        </Stack>
      </Modal>
    </Box>
  );
}
