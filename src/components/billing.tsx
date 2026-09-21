import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  Group,
  Input,
  Loader,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { CalendarDays, ChevronDown, FilePlus2, Pill, Printer, Receipt, RotateCcw, Trash2, User } from 'lucide-react';
import { debounce } from '../utils/debounce';
import { getMedicineByName, type Medicine } from '../services/medicine';
import { getBatchNumbersByMedicine, type BatchInfo } from '../services/inventory';
import { createBillingInvoice } from '../services/billing';
import { useNavigate } from 'react-router';
import { StatCell } from './StatCell';
import styles from './billing.module.css';

type BillingItem = {
  id: number;
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  hsnCode: string;
  quantity: number;
  packUnit: string;
  mrp: number;
  sellingPrice: number;
};

/** A line item with the tax maths already applied (see the `totals` memo). */
type CalculatedBillingItem = BillingItem & {
  total: number;
  discountAmount: number;
  gstRate: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
};

const emptyItem = (id: number): BillingItem => ({
  id,
  medicineName: '',
  batchNumber: '',
  expiryDate: '',
  hsnCode: '',
  quantity: 1,
  packUnit: 'Strip',
  mrp: 0,
  sellingPrice: 0,
});

const initialItems: BillingItem[] = [emptyItem(1)];

const HSN_OPTIONS = [
  { value: '30049099', label: '30049099 - Medicaments (GST 12%)' },
  { value: '30039011', label: '30039011 - Ayurvedic medicaments (GST 5%)' },
  { value: '30039099', label: '30039099 - Other medicaments (GST 5%)' },
  { value: '90189099', label: '90189099 - Medical instruments (GST 12%)' },
  { value: '33049900', label: '33049900 - Cosmetic / skin care (GST 18%)' },
  { value: '30051090', label: '30051090 - Adhesive dressings & bandages (GST 12%)' },
  { value: '21069099', label: '21069099 - Nutraceuticals / supplements (GST 18%)' },
];

const getGstRate = (hsnCode: string) => {
  if (hsnCode.startsWith('3004')) return 12;
  if (hsnCode.startsWith('3003')) return 5;
  if (hsnCode.startsWith('9018')) return 12;
  if (hsnCode.startsWith('3304')) return 18;
  if (hsnCode.startsWith('2106')) return 18;
  return 0;
};

const money = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const GST_SLABS = [0, 5, 12, 18, 28, 40];

/**
 * Layout breakpoint for the line-item editor.
 *
 * Below `md` (992px) the 13-column grid is replaced by one card per medicine:
 * a table that wide is unusable on a phone even when it pans, because every
 * cell holds an interactive control that would end up a few pixels wide.
 * `62em` is Mantine's `md` and the same breakpoint the app shell swaps its
 * sidebar on (see App.tsx), so both transitions line up.
 */
const COMPACT_LAYOUT_QUERY = '(max-width: 62em)';

/** Width at which the line-item grid stops compressing and starts panning. */
const LINE_ITEMS_MIN_WIDTH = 1220;

/** Width at which the GST-rate breakdown stops compressing and starts panning. */
const TAX_TABLE_MIN_WIDTH = 520;

// Server-side calls always use parameterized queries, so these allow-lists are defense-in-depth
// (reject SQL metacharacters / script payloads early) rather than the actual SQL-injection fix.
const PHONE_REGEX = /^[6-9]\d{9}$/;
const NAME_REGEX = /^[A-Za-z][A-Za-z .'-]{1,99}$/;

const getPhoneError = (value: string) => (value.trim() && !PHONE_REGEX.test(value.trim()) ? 'Enter a valid 10-digit mobile number' : null);
const getNameError = (value: string) => (value.trim() && !NAME_REGEX.test(value.trim()) ? 'Only letters, spaces, apostrophes, hyphens and periods are allowed' : null);
const getAgeError = (value: number | string) => (value !== '' && Number(value) <= 2 ? 'Age must be greater than 2' : null);
// Expiry is captured as an HTML month input (YYYY-MM); string comparison is safe since both sides share that format.
const getExpiryError = (value: string) => (value && value < new Date().toISOString().slice(0, 7) ? 'Expiry month cannot be before the current month' : null);

// Keeps disabled/read-only field text readable instead of Mantine's default faded style.
const disabledFieldStyles = { input: { color: 'var(--mantine-color-dark-9)', opacity: 1, fontWeight: 700, WebkitTextFillColor: 'var(--mantine-color-dark-9)' } };

export default function Billing() {
  const navigate = useNavigate();

  // Structural switch only — everything else is handled by style props/CSS.
  // Resolved during the first render (this app is client-only) so a phone
  // paints the card layout immediately instead of flashing the wide grid.
  const isCompactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY, false, { getInitialValueInEffect: false });
  // Cards get room for larger controls; the dense desktop grid needs `xs`.
  const controlSize = isCompactLayout ? 'sm' : 'xs';

  const [items, setItems] = useState<BillingItem[]>(initialItems);
  const [flatDiscount, setFlatDiscount] = useState<number | string>(0);
  const [paymentType, setPaymentType] = useState<string | null>('Cash');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [doctorName, setDoctorName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [patientAge, setPatientAge] = useState<number | string>('');
  const [patientGender, setPatientGender] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(['items', 'summary']);
  const [medicineSuggestions, setMedicineSuggestions] = useState<Record<number, Medicine[]>>({});
  const [medicineSearchLoading, setMedicineSearchLoading] = useState<Record<number, boolean>>({});
  const [batchOptions, setBatchOptions] = useState<Record<number, BatchInfo[]>>({});
  const [batchLoading, setBatchLoading] = useState<Record<number, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);
  const debouncedSearchers = useRef<Map<number, (name: string) => void>>(new Map());
  const medicineNameInputs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Moves focus to the medicine name field of the row that was just added, once it has rendered.
  useEffect(() => {
    if (pendingFocusId == null) return;
    const input = medicineNameInputs.current.get(pendingFocusId);
    if (input) {
      input.focus();
      setPendingFocusId(null);
    }
  }, [items, pendingFocusId]);

  const totals = useMemo(() => {
    const calculated = items.map((item) => {
      // MRP and selling price are tax-inclusive; taxable value is derived back from the GST rate.
      const total = item.quantity * item.sellingPrice;
      const discountAmount = Math.max(0, (item.mrp - item.sellingPrice) * item.quantity);
      const gstRate = getGstRate(item.hsnCode);
      const taxable = total / (1 + gstRate / 100);
      const gst = total - taxable;
      return { ...item, total, discountAmount, gstRate, taxable, gst, cgst: gst / 2, sgst: gst / 2 };
    });
    const taxable = calculated.reduce((sum, item) => sum + item.taxable, 0);
    const gst = calculated.reduce((sum, item) => sum + item.gst, 0);
    const discount = calculated.reduce((sum, item) => sum + item.discountAmount, 0);
    const beforeRound = taxable + gst - Number(flatDiscount || 0);
    const gstBreakdown = GST_SLABS.map((rate) => {
      const rows = calculated.filter((item) => item.gstRate === rate);
      const slabTaxable = rows.reduce((sum, item) => sum + item.taxable, 0);
      const slabGst = rows.reduce((sum, item) => sum + item.gst, 0);
      return { rate, taxable: slabTaxable, cgst: slabGst / 2, sgst: slabGst / 2, igst: 0 };
    });
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const grossAmount = calculated.reduce((sum, item) => sum + item.quantity * item.mrp, 0);
    return {
      calculated,
      taxable,
      gst,
      discount,
      beforeRound,
      gstBreakdown,
      totalQuantity,
      grossAmount,
      payable: Math.max(0, beforeRound),
    };
  }, [items, flatDiscount]);

  const updateItem = (id: number, field: keyof BillingItem, value: string | number) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  // Loads all batches recorded for the selected medicine so the user can pick one from a dropdown.
  // When no stock/batch exists for the medicine, it falls back to the catalog price (medicine?.price)
  // for MRP and clears stale batch, expiry and selling values from a previously selected medicine.
  const loadBatchesForItem = async (id: number, medicineName: string, medicine?: Medicine) => {
    setBatchLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const response = await getBatchNumbersByMedicine(medicineName);
      const rawBatches = response.data || [];

      // Dedupe by batch number (preferring the earliest-expiring duplicate)
      // and sort so the dropdown lists earliest-expiring batches first.
      const byBatchNumber = new Map<string, BatchInfo>();
      for (const batch of rawBatches) {
        const key = (batch.batchNumber || '').trim();
        if (!key) continue;
        const existing = byBatchNumber.get(key);
        if (!existing || (batch.expiryDate || '') < (existing.expiryDate || '')) {
          byBatchNumber.set(key, batch);
        }
      }
      const batches = [...byBatchNumber.values()].sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));

      setBatchOptions((prev) => ({ ...prev, [id]: batches }));

      const earliestExpiringBatch = batches.find((batch) => batch.expiryDate);

      setItems((current) => current.map((item) => {
        if (item.id !== id) return item;

        // A stock batch exists: keep the existing auto-fill using the earliest-expiring batch.
        if (earliestExpiringBatch) {
          return {
            ...item,
            batchNumber: earliestExpiringBatch.batchNumber,
            expiryDate: earliestExpiringBatch.expiryDate.slice(0, 7),
            mrp: earliestExpiringBatch.mrp !== undefined ? Number(earliestExpiringBatch.mrp) : item.mrp,
            sellingPrice: earliestExpiringBatch.sellingPrice !== undefined ? Number(earliestExpiringBatch.sellingPrice) : item.sellingPrice,
          };
        }

        // No inventory/batch for this medicine: default MRP to the catalog price (as in addinventory.tsx)
        // and wipe batch/expiry/selling leftovers so the row doesn't keep the previous medicine's data.
        const catalogPrice = medicine?.price != null ? Number(medicine.price) : NaN;
        return {
          ...item,
          batchNumber: '',
          expiryDate: '',
          mrp: Number.isFinite(catalogPrice) ? catalogPrice : 0,
          sellingPrice: 0,
        };
      }));
    } catch {
      setBatchOptions((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setBatchLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Populates expiry, MRP and selling price from the batch record chosen for this line item.
  const handleBatchSelect = (id: number, batchNumber: string | null) => {
    const batch = (batchOptions[id] || []).find((entry) => entry.batchNumber === batchNumber);
    setItems((current) => current.map((item) => item.id === id ? {
      ...item,
      batchNumber: batchNumber || '',
      expiryDate: batch?.expiryDate ? batch.expiryDate.slice(0, 7) : item.expiryDate,
      // Postgres NUMERIC columns arrive as strings; coerce so downstream math/formatting works.
      mrp: batch?.mrp !== undefined ? Number(batch.mrp) : item.mrp,
      sellingPrice: batch?.sellingPrice !== undefined ? Number(batch.sellingPrice) : item.sellingPrice,
    } : item));
  };

  // Lazily creates one debounced searcher per row so simultaneous edits don't cancel each other.
  const getDebouncedMedicineSearch = (id: number) => {
    if (!debouncedSearchers.current.has(id)) {
      debouncedSearchers.current.set(
        id,
        debounce(async (name: string) => {
          if (!name.trim()) {
            setMedicineSuggestions((prev) => ({ ...prev, [id]: [] }));
            setMedicineSearchLoading((prev) => ({ ...prev, [id]: false }));
            return;
          }
          setMedicineSearchLoading((prev) => ({ ...prev, [id]: true }));
          try {
            const response = await getMedicineByName(name);
            setMedicineSuggestions((prev) => ({ ...prev, [id]: response.data || [] }));
          } catch {
            setMedicineSuggestions((prev) => ({ ...prev, [id]: [] }));
          } finally {
            setMedicineSearchLoading((prev) => ({ ...prev, [id]: false }));
          }
        }, 400)
      );
    }
    return debouncedSearchers.current.get(id)!;
  };

  const handleMedicineNameSearch = (id: number, value: string) => {
    updateItem(id, 'medicineName', value);
    getDebouncedMedicineSearch(id)(value);
  };

  // Fired when the user explicitly picks a medicine from the suggestion dropdown.
  const handleMedicineSelect = (id: number, name: string, skuId?: string | number) => {
    // Resolve the full Medicine record (sku + price) from the current suggestions for this row
    // so the MRP can be prefilled from medicine?.price when the medicine has no stock/batch.
    const selectedMedicine = (medicineSuggestions[id] || []).find(
      (med) => med.name === name && (skuId === undefined || String(med.sku_id) === String(skuId))
    );
    updateItem(id, 'medicineName', name);
    setMedicineSuggestions((prev) => ({ ...prev, [id]: [] }));
    loadBatchesForItem(id, name, selectedMedicine);
  };

  const clearForm = () => {
    setItems([emptyItem(Date.now())]);
    setFlatDiscount(0);
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setSubmitAttempted(false);
  };

  const removeItem = (id: number) => {
    if (items.length <= 1) return;
    setItems((current) => current.filter((line) => line.id !== id));
    debouncedSearchers.current.delete(id);
    medicineNameInputs.current.delete(id);
    setMedicineSuggestions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setMedicineSearchLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setBatchOptions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setBatchLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  /* --------------------------------------------------------------------- *
   * Line-item controls
   *
   * Every field is defined once here and rendered by both the desktop grid
   * and the mobile card, so the two layouts can never drift apart. These are
   * plain render helpers rather than components: calling them inline keeps
   * each control's position in the tree stable, so typing never drops focus.
   * --------------------------------------------------------------------- */

  const renderMedicineField = (item: CalculatedBillingItem) => (
    <Autocomplete
      ref={(el) => {
        if (el) medicineNameInputs.current.set(item.id, el);
        else medicineNameInputs.current.delete(item.id);
      }}
      size={controlSize}
      placeholder="Medicine name"
      value={item.medicineName}
      error={submitAttempted && !item.medicineName.trim()}
      data={(medicineSuggestions[item.id] || []).map((med) => ({
        value: `${med.name}__${med.sku_id}`,
        label: med.name,
      }))}
      onChange={(value) => {
        const cleanName = value.includes('__') ? value.split('__')[0] : value;
        handleMedicineNameSearch(item.id, cleanName);
      }}
      onOptionSubmit={(selectedValue) => {
        const [selectedName, selectedSku] = selectedValue.split('__');
        handleMedicineSelect(item.id, selectedName, selectedSku);
      }}
      rightSection={medicineSearchLoading[item.id] ? <Loader size="xs" /> : null}
      // Capped to the viewport so the suggestion list never spills off a phone.
      comboboxProps={{
        withinPortal: true,
        width: 'min(320px, calc(100vw - 48px))',
        position: 'bottom-start',
        offset: 2,
      }}
      renderOption={({ option }) => {
        const [name, medId] = option.value.split('__');
        const med = (medicineSuggestions[item.id] || []).find(
          (m) => String(m.sku_id) === String(medId)
        );

        return (
          <Stack gap={0}>
            <Text size="sm" fw={600}>
              {med?.name ?? name}
            </Text>
            {med && (
              <Text size="xs" c="dimmed">
                {[med.manufacturer_name, med.type, med.pack_size_label]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            )}
          </Stack>
        );
      }}
    />
  );

  const renderBatchField = (item: CalculatedBillingItem) => (
    <Autocomplete
      size={controlSize}
      placeholder="Select or enter batch"
      error={submitAttempted && !item.batchNumber.trim()}
      data={(batchOptions[item.id] || []).map((batch) => batch.batchNumber)}
      value={item.batchNumber}
      filter={({ options }) => options}
      onChange={(value) => {
        updateItem(item.id, 'batchNumber', value);
      }}
      onOptionSubmit={(value) => handleBatchSelect(item.id, value)}
      rightSection={batchLoading[item.id] ? <Loader size="xs" /> : null}
      comboboxProps={{ withinPortal: true, width: 'min(280px, calc(100vw - 48px))' }}
    />
  );

  const renderExpiryField = (item: CalculatedBillingItem) => (
    <TextInput
      size={controlSize}
      type="month"
      value={item.expiryDate}
      onChange={(event) => updateItem(item.id, 'expiryDate', event.currentTarget.value)}
      error={!!getExpiryError(item.expiryDate) || (submitAttempted && !item.expiryDate)}
      styles={{ input: { paddingInline: 6 } }}
    />
  );

  const renderQuantityField = (item: CalculatedBillingItem) => (
    <NumberInput
      size={controlSize}
      min={1}
      value={item.quantity}
      onChange={(value) => updateItem(item.id, 'quantity', Number(value) || 0)}
      error={submitAttempted && item.quantity <= 0}
      hideControls
    />
  );

  const renderPackField = (item: CalculatedBillingItem) => (
    <Select
      size={controlSize}
      data={['Strip', 'Bottle', 'Box', 'Tube', 'Unit']}
      value={item.packUnit}
      onChange={(value) => updateItem(item.id, 'packUnit', value || 'Unit')}
    />
  );

  const renderMrpField = (item: CalculatedBillingItem) => (
    <NumberInput
      size={controlSize}
      min={0}
      decimalScale={2}
      value={item.mrp}
      onChange={(value) => updateItem(item.id, 'mrp', Number(value) || 0)}
      hideControls
    />
  );

  const renderSellingPriceField = (item: CalculatedBillingItem) => (
    <NumberInput
      size={controlSize}
      min={0}
      decimalScale={2}
      value={item.sellingPrice}
      onChange={(value) => updateItem(item.id, 'sellingPrice', Number(value) || 0)}
      error={submitAttempted && (item.sellingPrice > item.mrp || item.sellingPrice <= 0)}
      hideControls
    />
  );

  const renderHsnField = (item: CalculatedBillingItem) => (
    <Select
      size={controlSize}
      placeholder="Select HSN"
      searchable
      data={HSN_OPTIONS}
      value={item.hsnCode}
      onChange={(value) => updateItem(item.id, 'hsnCode', value || '')}
      error={submitAttempted && !item.hsnCode.trim()}
      // HSN labels are long, so the list is capped to the viewport on phones.
      comboboxProps={{ withinPortal: true, width: 'min(360px, calc(100vw - 48px))' }}
    />
  );

  /** Derived money values are read-only, so they render as an input on the
      dense desktop grid and as plain text inside a mobile card. */
  const renderReadonlyField = (value: string) => (
    <TextInput size={controlSize} disabled value={value} styles={disabledFieldStyles} />
  );

  const renderRemoveButton = (item: CalculatedBillingItem) => (
    <Tooltip
      label={items.length <= 1 ? 'At least one item is required' : 'Remove item'}
      withArrow
    >
      <ActionIcon
        // Widens the hit area to 44px on touch devices (see index.css).
        data-touch-target
        variant="subtle"
        color="red"
        radius="md"
        size={32}
        disabled={items.length <= 1}
        onClick={() => removeItem(item.id)}
        aria-label={`Remove ${item.medicineName.trim() || 'line item'}`}
      >
        <Trash2 size={16} />
      </ActionIcon>
    </Tooltip>
  );

  /** Desktop: one row of the dense 13-column grid. */
  const renderItemRow = (item: CalculatedBillingItem) => (
    <Table.Tr key={item.id}>
      <Table.Td>{renderMedicineField(item)}</Table.Td>
      <Table.Td>{renderBatchField(item)}</Table.Td>
      <Table.Td>{renderExpiryField(item)}</Table.Td>
      <Table.Td>{renderQuantityField(item)}</Table.Td>
      <Table.Td>{renderPackField(item)}</Table.Td>
      <Table.Td>{renderMrpField(item)}</Table.Td>
      <Table.Td>{renderSellingPriceField(item)}</Table.Td>
      <Table.Td>{renderReadonlyField(money(item.discountAmount))}</Table.Td>
      <Table.Td>{renderReadonlyField(`${item.gstRate}% · ${money(item.gst)}`)}</Table.Td>
      <Table.Td>{renderHsnField(item)}</Table.Td>
      <Table.Td>{renderReadonlyField(money(item.taxable))}</Table.Td>
      <Table.Td>{renderReadonlyField(money(item.total))}</Table.Td>
      <Table.Td>
        <Group justify="center">{renderRemoveButton(item)}</Group>
      </Table.Td>
    </Table.Tr>
  );

  /** Mobile/tablet: the same fields stacked as a labelled, tappable card. */
  const renderItemCard = (item: CalculatedBillingItem, index: number) => (
    <Paper key={item.id} withBorder radius="md" p="sm" className={styles.itemCard}>
      <Group justify="space-between" align="center" wrap="nowrap" gap="xs" mb="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge variant="light" color="blue" radius="sm" size="sm">
            Item {index + 1}
          </Badge>
          <Text size="sm" fw={600} truncate>
            {item.medicineName.trim() || 'New medicine'}
          </Text>
        </Group>
        {renderRemoveButton(item)}
      </Group>

      <Stack gap="sm">
        <Input.Wrapper label="Medicine name" required>
          {renderMedicineField(item)}
        </Input.Wrapper>

        <Input.Wrapper label="Batch number" required>
          {renderBatchField(item)}
        </Input.Wrapper>

        <SimpleGrid cols={2} spacing="sm">
          <Input.Wrapper label="Expiry (month)">{renderExpiryField(item)}</Input.Wrapper>
          <Input.Wrapper label="Pack">{renderPackField(item)}</Input.Wrapper>
          <Input.Wrapper label="Quantity">{renderQuantityField(item)}</Input.Wrapper>
          <Input.Wrapper label="MRP (₹)">{renderMrpField(item)}</Input.Wrapper>
          <Input.Wrapper label="Selling price (₹)" style={{ gridColumn: '1 / -1' }}>
            {renderSellingPriceField(item)}
          </Input.Wrapper>
        </SimpleGrid>

        <Input.Wrapper label="HSN code" required>
          {renderHsnField(item)}
        </Input.Wrapper>

        {/* Derived values — read-only, so they are shown as a summary strip
            instead of four more (disabled) inputs. */}
        <SimpleGrid cols={2} spacing="xs" p="xs" bg="gray.0" style={{ borderRadius: 'var(--mantine-radius-sm)' }}>
          <StatCell label="Discount" value={money(item.discountAmount)} tone="red.7" />
          <StatCell label="GST" value={`${item.gstRate}% · ${money(item.gst)}`} />
          <StatCell label="Taxable" value={money(item.taxable)} />
          <StatCell label="Line total" value={money(item.total)} />
        </SimpleGrid>
      </Stack>
    </Paper>
  );

  const handleSaveInvoice = async () => {
    setSubmitAttempted(true);
    const showValidationError = (message: string) => {
      notifications.show({
        title: 'Unable to save invoice',
        message,
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    };

    const invalidItem = totals.calculated.find((item) => {
      if (!item.medicineName.trim() || !item.batchNumber.trim() || !item.expiryDate || item.quantity <= 0) {
        return true;
      }
      if (getExpiryError(item.expiryDate)) {
        return true;
      }
      if (!item.hsnCode.trim()) {
        return true;
      }
      if (!Number.isFinite(item.sellingPrice) || item.sellingPrice <= 0) {
        return true;
      }
      if (item.mrp > 0 && item.sellingPrice > item.mrp) {
        return true;
      }
      return item.discountAmount > item.sellingPrice * item.quantity;
    });

    if (invalidItem) {
      const item = invalidItem;
      if (!item.medicineName.trim() || !item.batchNumber.trim() || !item.expiryDate || item.quantity <= 0) {
        showValidationError('Complete the medicine name, batch, expiry date, and quantity before saving.');
      } else if (getExpiryError(item.expiryDate)) {
        showValidationError(getExpiryError(item.expiryDate) as string);
      } else if (!item.hsnCode.trim()) {
        showValidationError('HSN code is required for every medicine item.');
      } else if (!Number.isFinite(item.sellingPrice) || item.sellingPrice <= 0) {
        showValidationError('Selling price must be greater than zero for every medicine item.');
      } else if (item.mrp > 0 && item.sellingPrice > item.mrp) {
        showValidationError('Selling price cannot be greater than MRP when MRP is provided.');
      } else {
        showValidationError('Item discount cannot be greater than the item selling amount.');
      }
      return;
    }

    const phoneError = getPhoneError(phoneNumber);
    if (phoneError) {
      showValidationError(phoneError);
      return;
    }

    const ageError = getAgeError(patientAge);
    if (ageError) {
      showValidationError(ageError);
      return;
    }

    const doctorNameError = getNameError(doctorName);
    if (doctorNameError) {
      showValidationError(`Doctor name: ${doctorNameError}`);
      return;
    }

    const customerNameError = getNameError(customerName);
    if (customerNameError) {
      showValidationError(`Customer name: ${customerNameError}`);
      return;
    }

    const flatDiscountAmount = Number(flatDiscount || 0);
    if (!Number.isFinite(flatDiscountAmount) || flatDiscountAmount < 0) {
      showValidationError('Flat discount cannot be negative.');
      
      return;
    }
    if (!Number.isFinite(totals.beforeRound) || totals.beforeRound < 0) {
      showValidationError('Subtotal cannot be less than zero.');
      return;
    }
    if (flatDiscountAmount > totals.beforeRound) {
      showValidationError('Flat discount cannot be greater than the subtotal.');
      return;
    }
    if (!Number.isFinite(totals.payable) || totals.payable < 0) {
      showValidationError('Final payable amount cannot be less than zero.');
      return;
    }

    setSaveLoading(true);

    try {
      const response = await createBillingInvoice({
        doctorName: doctorName.trim() || undefined,
        paymentType: paymentType || 'Cash',
        customerName: customerName.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        patientAge: patientAge === '' ? null : Number(patientAge),
        patientGender: patientGender || undefined,
        address: address.trim() || undefined,
        gstin: gstin.trim() || undefined,
        taxBreakdown: totals.gstBreakdown,
        totalQuantity: totals.totalQuantity,
        grossAmount: totals.grossAmount,
        discountAmount: totals.discount,
        subtotal: totals.beforeRound,
        flatDiscount: flatDiscountAmount,
        finalPayable: totals.payable,
        items: totals.calculated.map((item) => ({
          medicineId: medicineSuggestions[item.id]?.find((med) => med.name === item.medicineName)?.sku_id || null,
          medicineName: item.medicineName.trim(),
          batch: item.batchNumber.trim(),
          expiryDate: `${item.expiryDate}-01`,
          qty: item.quantity,
          pack: item.packUnit,
          mrp: item.mrp,
          sellingPrice: item.sellingPrice,
          discount: item.discountAmount,
          gstPercentage: item.gstRate,
          gstAmount: item.gst,
          hsnCode: item.hsnCode || undefined,
          taxableAmount: item.taxable,
          total: item.total,
        })),
      });

      notifications.show({
        title: 'Invoice saved',
        message: response.message || 'Invoice saved successfully.',
        color: 'teal',
        icon: <IconCircleCheck size={18} />,
      });
      clearForm();
    } catch (error) {
      notifications.show({
        title: 'Unable to save invoice',
        message: error instanceof Error ? error.message : 'Failed to save invoice.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      navigate('/Invoices')
      setSaveLoading(false);
    }
  };

  // Collapsed section headers get a light blue tint; expanded ones stay neutral.
  const sectionControlBg = (value: string) => (openSections.includes(value) ? 'blue.0' : 'blue.0');

  return (
    <Stack gap="lg" maw={1500} mx="auto">
      <div>
        <Group gap="sm" mb={4}>
          <Title order={2} fz={{ base: 'h3', md: 'h2' }}>Create pharmacy invoice</Title>
        </Group>
        <Text c="dimmed" size="sm">Capture patient, prescriber and medicine details in one bill.</Text>
      </div>

      <Paper withBorder p={{ base: 'sm', sm: 'md' }} radius="md">
        <Group gap="xs" mb="sm" p="xs" bg="blue.0" wrap="nowrap" style={{ borderRadius: 6 }}>
          <CalendarDays size={18} color="var(--mantine-color-blue-7)" style={{ flexShrink: 0 }} />
          <Text fw={700} c="blue.8" fz={{ base: 'sm', md: 'md' }}>Invoice information</Text>
        </Group>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
          <TextInput label="Invoice date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.currentTarget.value)} required disabled styles={disabledFieldStyles} />
          <TextInput label="Doctor name" placeholder="Dr. Ananya Sharma" value={doctorName} onChange={(event) => setDoctorName(event.currentTarget.value)} error={getNameError(doctorName)} />
          <Select label="Payment type" data={['Cash', 'UPI', 'Card', 'Credit']} value={paymentType} onChange={setPaymentType} />
          {(paymentType === 'UPI' || paymentType === 'Card') && <TextInput label="Payment reference" placeholder="UTR / last 4 digits" />}
        </SimpleGrid>
      </Paper>

      <Accordion
        multiple
        variant="separated"
        value={openSections}
        onChange={setOpenSections}
        radius="md"
        chevron={<ChevronDown size={20} strokeWidth={3} color="var(--mantine-color-blue-6)" />}
        styles={{ control: { fontWeight: 700 }, chevron: { width: 20, height: 20 } }}
      >
        <Accordion.Item value="customer">
          <Accordion.Control>
            <Group gap="xs" p="xs" bg={sectionControlBg('customer')} wrap="nowrap" style={{ borderRadius: 6 }}>
              <User size={18} color="var(--mantine-color-blue-7)" style={{ flexShrink: 0 }} />
              <Text fw={700} c="blue.8" fz={{ base: 'sm', md: 'md' }}>Customer / patient information</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel><SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            <TextInput label="Customer name" placeholder="Full name" value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} error={getNameError(customerName)} />
            <TextInput label="Phone number" placeholder="10-digit mobile number" value={phoneNumber} onChange={(event) => setPhoneNumber(event.currentTarget.value)} error={getPhoneError(phoneNumber)} />
            <NumberInput label="Age" min={3} max={120} placeholder="Years" value={patientAge} onChange={setPatientAge} error={getAgeError(patientAge)} />
            <Select label="Gender" placeholder="Select gender" data={['Female', 'Male', 'Other', 'Prefer not to say']} value={patientGender} onChange={setPatientGender} />
            <TextInput label="Address" placeholder="Billing address" value={address} onChange={(event) => setAddress(event.currentTarget.value)} />
            <TextInput label="GSTIN (optional)" placeholder="For business customers" value={gstin} onChange={(event) => setGstin(event.currentTarget.value)} />
          </SimpleGrid></Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="items">
          <Accordion.Control>
            <Group gap="xs" p="xs" bg={sectionControlBg('items')} wrap="wrap" style={{ borderRadius: 6 }}>
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Pill size={18} color="var(--mantine-color-blue-7)" style={{ flexShrink: 0 }} />
                <Text fw={700} c="blue.8" fz={{ base: 'sm', md: 'md' }}>Medicine items</Text>
              </Group>
              <Badge variant="light">{items.length} {items.length === 1 ? 'line' : 'lines'}</Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Text size="xs" c="dimmed">GST is inferred from the selected HSN code: 3003 / 2106 = 5%/18%, 3004 / 9018 / 3005 = 12%, 3304 = 18%.</Text>

              {isCompactLayout ? (
                /* Phones & tablets: one card per medicine. Every field keeps a
                   full-size tap target instead of being squeezed into a cell. */
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {totals.calculated.length === 0 ? (
                    <Text c="dimmed" ta="center" py="md">
                      No medicines added yet. Tap &ldquo;Add medicine&rdquo; to start billing.
                    </Text>
                  ) : (
                    totals.calculated.map((item, index) => renderItemCard(item, index))
                  )}
                </SimpleGrid>
              ) : (
                /* Desktop: the dense 13-column grid. Its overflow stays inside
                   this container, so the page never scrolls sideways. */
                <Table.ScrollContainer
                  minWidth={LINE_ITEMS_MIN_WIDTH}
                  type="native"
                  className={styles.scrollX}
                >
                  <Table verticalSpacing="xs" horizontalSpacing="xs" highlightOnHover style={{ tableLayout: 'fixed', width: '100%' }} fz="xs">
                    <Table.Thead><Table.Tr>
                      <Table.Th style={{ width: '15%' }}>Medicine</Table.Th>
                      <Table.Th style={{ width: '7%' }}>Batch</Table.Th>
                      <Table.Th style={{ width: '11%' }}>Expiry</Table.Th>
                      <Table.Th style={{ width: '5%' }}>Qty</Table.Th>
                      <Table.Th style={{ width: '6%' }}>Pack</Table.Th>
                      <Table.Th style={{ width: '7%' }}>MRP</Table.Th>
                      <Table.Th style={{ width: '7%' }}>Selling</Table.Th>
                      <Table.Th style={{ width: '8%' }}>Discount</Table.Th>
                      <Table.Th style={{ width: '8%' }}>GST</Table.Th>
                      <Table.Th style={{ width: '8%' }}>HSN code</Table.Th>
                      <Table.Th style={{ width: '8%' }}>Taxable</Table.Th>
                      <Table.Th style={{ width: '8%' }}>Total</Table.Th>
                      <Table.Th w={48} ta="center">Remove</Table.Th>
                    </Table.Tr></Table.Thead>
                    <Table.Tbody>{totals.calculated.length === 0 ? (
                      <Table.Tr><Table.Td colSpan={13}><Text c="dimmed" ta="center" py="md">No medicines added yet. Click "Add medicine" to start billing.</Text></Table.Td></Table.Tr>
                    ) : totals.calculated.map((item) => renderItemRow(item))}</Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}

              <Button
                variant="light"
                leftSection={<FilePlus2 size={16} />}
                onClick={() => {
                  const newId = Date.now();
                  setItems((current) => [...current, emptyItem(newId)]);
                  setPendingFocusId(newId);
                }}
                // Full-width and 44px tall on phones, inline-sized from `sm` up.
                h={{ base: 44, sm: 36 }}
                w={{ base: '100%', sm: 'fit-content' }}
              >
                Add medicine
              </Button>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="summary">
          <Accordion.Control>
            <Group gap="xs" p="xs" bg={sectionControlBg('summary')} wrap="nowrap" style={{ borderRadius: 6 }}>
              <Receipt size={18} color="var(--mantine-color-blue-7)" style={{ flexShrink: 0 }} />
              <Text fw={700} c="blue.8" fz={{ base: 'sm', md: 'md' }}>Bill summary and taxes</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel><Grid align="flex-start">
            <Grid.Col span={{ base: 12, md: 7 }}>
              {/* Five columns of figures need ~520px before they start to
                  squeeze — below that they pan inside this container. */}
              <Table.ScrollContainer minWidth={TAX_TABLE_MIN_WIDTH} type="native" className={styles.scrollX}>
                <Table withTableBorder withColumnBorders fz={{ base: 'sm', md: 'xs' }}>
                  <Table.Thead><Table.Tr><Table.Th>GST%</Table.Th><Table.Th>Taxable Amt (₹)</Table.Th><Table.Th>CGST (₹)</Table.Th><Table.Th>SGST (₹)</Table.Th><Table.Th>IGST (₹)</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>{totals.gstBreakdown.map((slab) => (
                    <Table.Tr key={slab.rate}>
                      <Table.Td>{slab.rate}</Table.Td>
                      <Table.Td>{slab.taxable.toLocaleString('en-IN', { minimumFractionDigits: slab.taxable ? 2 : 0, maximumFractionDigits: 2 })}</Table.Td>
                      <Table.Td>{slab.cgst.toLocaleString('en-IN', { minimumFractionDigits: slab.cgst ? 2 : 0, maximumFractionDigits: 2 })}</Table.Td>
                      <Table.Td>{slab.sgst.toLocaleString('en-IN', { minimumFractionDigits: slab.sgst ? 2 : 0, maximumFractionDigits: 2 })}</Table.Td>
                      <Table.Td>{slab.igst}</Table.Td>
                    </Table.Tr>
                  ))}</Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap="sm">
                <Table withTableBorder withColumnBorders verticalSpacing="xs" fz={{ base: 'sm', md: 'xs' }}>
                  <Table.Tbody>
                    <Table.Tr><Table.Td fw={600}>TOTAL QUANTITY</Table.Td><Table.Td ta="right">{totals.totalQuantity}</Table.Td></Table.Tr>
                    <Table.Tr><Table.Td fw={600}>GROSS AMOUNT</Table.Td><Table.Td ta="right" className={styles.moneyValue}>{money(totals.grossAmount)}</Table.Td></Table.Tr>
                    <Table.Tr><Table.Td fw={600}>DISCOUNT AMOUNT</Table.Td><Table.Td ta="right" c="red" className={styles.moneyValue}>-{money(totals.discount)}</Table.Td></Table.Tr>
                  </Table.Tbody>
                </Table>
                <Divider my={2} />
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={700}>Subtotal</Text>
                  <Text fw={700} className={styles.moneyValue}>{money(totals.beforeRound)}</Text>
                </Group>
                <NumberInput
                  label="Flat discount"
                  prefix="₹"
                  min={0}
                  value={flatDiscount}
                  onChange={setFlatDiscount}
                  hideControls
                  // Full width on phones, a compact field from `md` up.
                  maw={{ base: '100%', md: 220 }}
                />
                <Paper p={{ base: 'sm', md: 'md' }} bg="blue.7" c="white" radius="md">
                  {/* Stacks on the narrowest phones so the amount never wraps. */}
                  <Flex
                    direction={{ base: 'column', xs: 'row' }}
                    justify="space-between"
                    align={{ base: 'flex-start', xs: 'center' }}
                    gap="xs"
                  >
                    <Text fw={600}>Final payable</Text>
                    <Title order={3} fz={{ base: 'h4', md: 'h3' }} className={styles.moneyValue}>
                      {money(totals.payable)}
                    </Title>
                  </Flex>
                </Paper>
              </Stack>
            </Grid.Col>
          </Grid></Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {/* Sticky bar: Save stays one thumb-tap away while scrolling a long bill.
          Full-width stacked buttons on phones, right-aligned from `sm` up. */}
      <Box className="app-sticky-actions">
        <Flex direction={{ base: 'column-reverse', sm: 'row' }} justify="flex-end" gap="sm">
          <Button variant="default" leftSection={<RotateCcw size={16} />} onClick={clearForm} h={{ base: 44, sm: 36 }} w={{ base: '100%', sm: 'auto' }}>
            Clear form
          </Button>
          <Button variant="light" leftSection={<Printer size={16} />} onClick={() => window.print()} h={{ base: 44, sm: 36 }} w={{ base: '100%', sm: 'auto' }}>
            Print
          </Button>
          <Button leftSection={<FilePlus2 size={16} />} onClick={handleSaveInvoice} loading={saveLoading} disabled={saveLoading} h={{ base: 44, sm: 36 }} w={{ base: '100%', sm: 'auto' }}>
            Save invoice
          </Button>
        </Flex>
      </Box>
    </Stack>
  );
}