// components/Invoices.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCircleCheck,
  IconDownload,
  IconEye,
  IconInbox,
  IconListDetails,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import InvoicePrint from './InvoicePrint';
import {
  getBillingInvoice,
  listBillingInvoices,
  updateBillingInvoice,
  type BillingInvoiceDetail,
  type BillingInvoiceItem,
  type BillingInvoiceListItem,
} from '../services/billing';
import { API_BASE_URL } from '../services/apiClient';
import { getMedicineByName, type Medicine } from '../services/medicine';
import { getBatchNumbersByMedicine, type BatchInfo } from '../services/inventory';
import { debounce } from '../utils/debounce';
import { useNavigate } from 'react-router';
const TABLE_COLUMN_COUNT = 9;
const SKELETON_ROW_COUNT = 6;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PAYMENT_COLORS: Record<string, string> = {
  Cash: 'green',
  UPI: 'violet',
  Card: 'blue',
  Credit: 'orange',
};

const HSN_OPTIONS = [
  { value: '30049099', label: '30049099 - Medicaments (GST 12%)' },
  { value: '30039011', label: '30039011 - Ayurvedic medicaments (GST 5%)' },
  { value: '30039099', label: '30039099 - Other medicaments (GST 5%)' },
  { value: '90189099', label: '90189099 - Medical instruments (GST 12%)' },
  { value: '33049900', label: '33049900 - Cosmetic / skin care (GST 18%)' },
  { value: '30051090', label: '30051090 - Adhesive dressings & bandages (GST 12%)' },
  { value: '21069099', label: '21069099 - Nutraceuticals / supplements (GST 18%)' },
];

const GST_SLABS = [0, 5, 12, 18, 28, 40];

const getGstRate = (hsnCode: string) => {
  if (hsnCode.startsWith('3004')) return 12;
  if (hsnCode.startsWith('3003')) return 5;
  if (hsnCode.startsWith('9018')) return 12;
  if (hsnCode.startsWith('3304')) return 18;
  if (hsnCode.startsWith('2106')) return 18;
  return 0;
};

// Server-side calls always use parameterized queries, so these allow-lists are defense-in-depth
// (reject SQL metacharacters / script payloads early) rather than the actual SQL-injection fix.
const PHONE_REGEX = /^[6-9]\d{9}$/;
const NAME_REGEX = /^[A-Za-z][A-Za-z .'-]{1,99}$/;

const getPhoneError = (value: string) => (value.trim() && !PHONE_REGEX.test(value.trim()) ? 'Enter a valid 10-digit mobile number' : null);
const getNameError = (value: string) => (value.trim() && !NAME_REGEX.test(value.trim()) ? 'Only letters, spaces, apostrophes, hyphens and periods are allowed' : null);
const getExpiryError = (value: string) => (value && value < new Date().toISOString().slice(0, 10) ? 'Expiry date cannot be in the past' : null);

type EditableInvoiceItem = {
  id: number;
  medicineId: number | null;
  medicineName: string;
  batch: string;
  expiryDate: string;
  hsnCode: string;
  qty: number;
  pack: string;
  mrp: number;
  sellingPrice: number;
};

// Postgres DECIMAL columns arrive as strings, so coerce before formatting.
const money = (value: string | number | null | undefined) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Postgres DATE columns can serialize as "YYYY-MM-DD" or a full ISO timestamp.
// Parsing the date parts directly avoids an off-by-one caused by timezone shifting.
function formatInvoiceDate(value: string | null): string {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value).slice(0, 10);
  const month = MONTHS[Number(match[2]) - 1] ?? '';
  return `${match[3]} ${month} ${match[1]}`;
}

function PaymentBadge({ paymentType }: { paymentType: string }) {
  return (
    <Badge color={PAYMENT_COLORS[paymentType] ?? 'gray'} variant="light" radius="sm">
      {paymentType || '—'}
    </Badge>
  );
}

// Total GST charged on an invoice = sum of CGST + SGST (+ IGST) across every tax slab
// stored in the invoice's tax_breakdown.
function getInvoiceGst(row: BillingInvoiceListItem): number {
  const breakdown = Array.isArray(row.tax_breakdown) ? row.tax_breakdown : [];
  return breakdown.reduce(
    (sum, slab) =>
      sum + Number(slab.cgst ?? 0) + Number(slab.sgst ?? 0) + Number(slab.igst ?? 0),
    0
  );
}

export default function Invoices() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchTerm, 350);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalRecords, setTotalRecords] = useState(0);

  const [records, setRecords] = useState<BillingInvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const totalPages = Math.ceil(totalRecords / pageSize);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // View modal state
  const [viewInvoice, setViewInvoice] = useState<BillingInvoiceListItem | null>(null);
  const [viewDetail, setViewDetail] = useState<BillingInvoiceDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  // Edit modal state
  const [editInvoice, setEditInvoice] = useState<BillingInvoiceListItem | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editItems, setEditItems] = useState<EditableInvoiceItem[]>([]);
  const [editItemsLoading, setEditItemsLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const nextEditItemId = useRef(-1);
  const [editMedicineSuggestions, setEditMedicineSuggestions] = useState<Record<number, Medicine[]>>({});
  const [editMedicineSearchLoading, setEditMedicineSearchLoading] = useState<Record<number, boolean>>({});
  const editDebouncedSearchers = useRef<Map<number, (name: string) => void>>(new Map());
  const [editBatchOptions, setEditBatchOptions] = useState<Record<number, BatchInfo[]>>({});
  const [editBatchLoading, setEditBatchLoading] = useState<Record<number, boolean>>({});
  const medicineNameRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // Print / PDF preview state
  const [printInvoice, setPrintInvoice] = useState<BillingInvoiceListItem | null>(null);
  const [printDetail, setPrintDetail] = useState<BillingInvoiceDetail | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Reset to the first page whenever search or page size changes.
  useEffect(() => {
    setActivePage(1);
  }, [searchTerm, pageSize]);

  useEffect(() => {
    let ignore = false;

    async function loadInvoices() {
      setLoading(true);
      setError(null);
      try {
        const response = await listBillingInvoices({ page: activePage, limit: pageSize });
        if (ignore) return;

        const rows = response.data ?? [];
        const total = response.pagination?.total ?? 0;
        setRecords(rows);
        setTotalRecords(total);
      } catch (err) {
        if (ignore) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to reach the billing server. Please try again shortly.'
        );
        setRecords([]);
        setTotalRecords(0);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadInvoices();
    return () => {
      ignore = true;
    };
  }, [activePage, pageSize, refreshKey]);

  // The list endpoint has no server-side search yet, so filter the current page client-side.
  const filteredRecords = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return records;
    return records.filter((row) =>
      [row.invoice_number, row.customer_name, row.doctor_name, row.payment_type, row.phone_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [records, debouncedSearch]);

  const openView = async (row: BillingInvoiceListItem) => {
    setViewInvoice(row);
    setViewDetail(null);
    setViewError(null);
    setViewLoading(true);
    try {
      const response = await getBillingInvoice(row.invoice_number);
      setViewDetail(response.data ?? null);
      if (!response.data) setViewError('No details found for this invoice.');
    } catch (err) {
      setViewError(err instanceof Error ? err.message : 'Failed to load invoice details.');
    } finally {
      setViewLoading(false);
    }
  };

  const openEdit = async (row: BillingInvoiceListItem) => {
    setEditInvoice(row);
    setEditError(null);
    setEditForm({
      doctorName: row.doctor_name ?? '',
      paymentType: row.payment_type ?? 'Cash',
      customerName: row.customer_name ?? '',
      phoneNumber: row.phone_number ?? '',
      patientAge: row.patient_age != null ? String(row.patient_age) : '',
      patientGender: row.patient_gender ?? '',
      address: row.address ?? '',
      gstin: row.gstin ?? '',
      flatDiscount: row.flat_discount != null ? String(row.flat_discount) : '0',
    });
    setEditItems([]);
    setEditItemsLoading(true);
    try {
      const response = await getBillingInvoice(row.invoice_number);
      const items = response.data?.items ?? [];
      setEditItems(
        items.map((item) => ({
          id: item.item_id,
          medicineId: item.medicine_id,
          medicineName: item.medicine_name,
          batch: item.batch,
          expiryDate: String(item.expiry_date).slice(0, 7),
          hsnCode: item.hsn_code ?? '',
          qty: item.qty,
          pack: item.pack,
          mrp: Number(item.mrp),
          sellingPrice: Number(item.selling_price),
        }))
      );
      if (!response.data) setEditError('No line items found for this invoice.');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to load invoice items.');
    } finally {
      setEditItemsLoading(false);
    }
  };

  const openPrint = async (row: BillingInvoiceListItem) => {
    setPrintInvoice(row);
    setPrintDetail(null);
    setPrintError(null);
    setPrintLoading(true);
    try {
      const response = await getBillingInvoice(row.invoice_number);
      setPrintDetail(response.data ?? null);
      if (!response.data) setPrintError('No details found for this invoice.');
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Failed to load invoice details.');
    } finally {
      setPrintLoading(false);
    }
  };

  // Prints only the invoice (not the whole app) by writing the rendered sheet
  // into a fresh window and invoking the browser's print dialog there.
  const handlePrintInvoice = () => {
    const node = printRef.current;
    if (!node || !printDetail) return;
    const printWindow = window.open('', '_blank', 'width=850,height=1100');
    if (!printWindow) {
      notifications.show({
        title: 'Popup blocked',
        message: 'Please allow pop-ups so the invoice can be printed.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
      return;
    }
    printWindow.document.write(
      `<!doctype html><html><head><meta charset="utf-8" /><title>${printDetail.invoice.invoice_number}</title><style>@page { size: A4; margin: 0; } body { margin: 0; background: #ffffff; }</style></head><body>${node.outerHTML}<script>window.onload = function () { window.print(); };</script></body></html>`
    );
    printWindow.document.close();
  };

  const handleDownloadPdf = async () => {
    const node = printRef.current;
    if (!node || !printDetail) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${printDetail.invoice.invoice_number}.pdf`);
      notifications.show({
        title: 'PDF downloaded',
        message: 'The invoice PDF has been generated and saved.',
        color: 'teal',
        icon: <IconCircleCheck size={18} />,
      });
    } catch (err) {
      notifications.show({
        title: 'Unable to download PDF',
        message: err instanceof Error ? err.message : 'PDF generation failed. Please try again.',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setPdfLoading(false);
    }
  };

  const setField = (field: string, value: string) =>
    setEditForm((prev) => ({ ...prev, [field]: value }));

  const updateEditItem = (id: number, field: keyof EditableInvoiceItem, value: string | number) =>
    setEditItems((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));

  const addEditItem = () => {
    const id = nextEditItemId.current--;
    setEditItems((current) => [
      ...current,
      { id, medicineId: null, medicineName: '', batch: '', expiryDate: '', hsnCode: '', qty: 1, pack: 'Strip', mrp: 0, sellingPrice: 0 },
    ]);
    // Focus the medicine name input for the newly added row after render
    setTimeout(() => {
      const input = medicineNameRefs.current[id];
      if (input) input.focus();
    }, 0);
  };

  const removeEditItem = (id: number) => {
    setEditItems((current) => (current.length <= 1 ? current : current.filter((item) => item.id !== id)));
    editDebouncedSearchers.current.delete(id);
    setEditMedicineSuggestions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setEditMedicineSearchLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setEditBatchOptions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setEditBatchLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  // Loads all batches recorded for the selected medicine so expiry/MRP/selling price can auto-fill.
  const loadBatchesForEditItem = async (id: number, medicineName: string) => {
    setEditBatchLoading((prev) => ({ ...prev, [id]: true }));
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

      setEditBatchOptions((prev) => ({ ...prev, [id]: batches }));

      const earliestExpiringBatch = batches.find((batch) => batch.expiryDate);
      if (earliestExpiringBatch) {
        setEditItems((current) => current.map((item) => item.id === id ? {
          ...item,
          batch: earliestExpiringBatch.batchNumber,
          expiryDate: earliestExpiringBatch.expiryDate.slice(0, 10),
          mrp: earliestExpiringBatch.mrp !== undefined ? Number(earliestExpiringBatch.mrp) : item.mrp,
          sellingPrice: earliestExpiringBatch.sellingPrice !== undefined ? Number(earliestExpiringBatch.sellingPrice) : item.sellingPrice,
        } : item));
      }
    } catch {
      setEditBatchOptions((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setEditBatchLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Populates expiry, MRP and selling price from the batch record chosen for this line item.
  const handleEditBatchSelect = (id: number, batchNumber: string | null) => {
    const batch = (editBatchOptions[id] || []).find((entry) => entry.batchNumber === batchNumber);
    setEditItems((current) => current.map((item) => item.id === id ? {
      ...item,
      batch: batchNumber || '',
      expiryDate: batch?.expiryDate ? batch.expiryDate.slice(0, 7) : item.expiryDate,
      mrp: batch?.mrp !== undefined ? Number(batch.mrp) : item.mrp,
      sellingPrice: batch?.sellingPrice !== undefined ? Number(batch.sellingPrice) : item.sellingPrice,
    } : item));
  };

  // Lazily creates one debounced searcher per row so simultaneous edits don't cancel each other.
  const getEditDebouncedMedicineSearch = (id: number) => {
    if (!editDebouncedSearchers.current.has(id)) {
      editDebouncedSearchers.current.set(
        id,
        debounce(async (name: string) => {
          if (!name.trim()) {
            setEditMedicineSuggestions((prev) => ({ ...prev, [id]: [] }));
            setEditMedicineSearchLoading((prev) => ({ ...prev, [id]: false }));
            return;
          }
          setEditMedicineSearchLoading((prev) => ({ ...prev, [id]: true }));
          try {
            const response = await getMedicineByName(name);
            setEditMedicineSuggestions((prev) => ({ ...prev, [id]: response.data || [] }));
          } catch {
            setEditMedicineSuggestions((prev) => ({ ...prev, [id]: [] }));
          } finally {
            setEditMedicineSearchLoading((prev) => ({ ...prev, [id]: false }));
          }
        }, 400)
      );
    }
    return editDebouncedSearchers.current.get(id)!;
  };

  const handleEditMedicineNameSearch = (id: number, value: string) => {
    updateEditItem(id, 'medicineName', value);
    getEditDebouncedMedicineSearch(id)(value);
  };

  // Fired when the user explicitly picks a medicine from the suggestion dropdown.
  const handleEditMedicineSelect = (id: number, medicineId: number | null, name: string) => {
    updateEditItem(id, 'medicineName', name);
    setEditItems((current) => current.map((item) => (item.id === id ? { ...item, medicineId } : item)));
    setEditMedicineSuggestions((prev) => ({ ...prev, [id]: [] }));
    loadBatchesForEditItem(id, name);
  };

  // Mirrors the calculation used when an invoice is first created (billing.tsx) so recalculated
  // totals stay consistent: MRP/selling price are tax-inclusive, taxable value is derived from GST rate.
  const editTotals = useMemo(() => {
    const flatDiscountAmount = Number(editForm.flatDiscount || 0);
    const calculated = editItems.map((item) => {
      const total = item.qty * item.sellingPrice;
      const discountAmount = Math.max(0, (item.mrp - item.sellingPrice) * item.qty);
      const gstRate = getGstRate(item.hsnCode);
      const taxable = total / (1 + gstRate / 100);
      const gst = total - taxable;
      return { ...item, total, discountAmount, gstRate, taxable, gst };
    });
    const taxable = calculated.reduce((sum, item) => sum + item.taxable, 0);
    const gst = calculated.reduce((sum, item) => sum + item.gst, 0);
    const discount = calculated.reduce((sum, item) => sum + item.discountAmount, 0);
    const beforeRound = taxable + gst - flatDiscountAmount;
    const gstBreakdown = GST_SLABS.map((rate) => {
      const rows = calculated.filter((item) => item.gstRate === rate);
      const slabTaxable = rows.reduce((sum, item) => sum + item.taxable, 0);
      const slabGst = rows.reduce((sum, item) => sum + item.gst, 0);
      return { rate, taxable: slabTaxable, cgst: slabGst / 2, sgst: slabGst / 2, igst: 0 };
    });
    const totalQuantity = editItems.reduce((sum, item) => sum + item.qty, 0);
    const grossAmount = calculated.reduce((sum, item) => sum + item.qty * item.mrp, 0);
    return {
      calculated,
      discount,
      beforeRound,
      preDiscountSubtotal: taxable + gst,
      gstBreakdown,
      totalQuantity,
      grossAmount,
      flatDiscountAmount,
      payable: Math.max(0, beforeRound),
    };
  }, [editItems, editForm.flatDiscount]);

  const handleSaveEdit = async () => {
    setSubmitAttempted(true);
    const setEditError = (message: string) => {
      notifications.show({
        title: 'Unable to save invoice',
        message,
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    };
    if (!editInvoice) return;

    const phoneError = getPhoneError(editForm.phoneNumber ?? '');
    if (phoneError) return setEditError(phoneError);

    const doctorNameError = getNameError(editForm.doctorName ?? '');
    if (doctorNameError) return setEditError(`Doctor name: ${doctorNameError}`);

    const customerNameError = getNameError(editForm.customerName ?? '');
    if (customerNameError) return setEditError(`Customer name: ${customerNameError}`);

    const invalidItem = editTotals.calculated.find((item) => {
      if (!item.medicineName.trim() || !item.batch.trim() || !item.expiryDate || item.qty <= 0) return true;
      if (getExpiryError(item.expiryDate)) return true;
      if (!item.hsnCode.trim()) return true;
      if (!Number.isFinite(item.sellingPrice) || item.sellingPrice <= 0) return true;
      if (item.mrp > 0 && item.sellingPrice > item.mrp) return true;
      return item.discountAmount > item.sellingPrice * item.qty;
    });
    if (invalidItem) {
      if (!invalidItem.medicineName.trim() || !invalidItem.batch.trim() || !invalidItem.expiryDate || invalidItem.qty <= 0) {
        setEditError('Complete the medicine name, batch, expiry date, and quantity for every item.');
      } else if (getExpiryError(invalidItem.expiryDate)) {
        setEditError(getExpiryError(invalidItem.expiryDate) as string);
      } else if (!invalidItem.hsnCode.trim()) {
        setEditError('HSN code is required for every medicine item.');
      } else if (!Number.isFinite(invalidItem.sellingPrice) || invalidItem.sellingPrice <= 0) {
        setEditError('Selling price must be greater than zero for every medicine item.');
      } else if (invalidItem.mrp > 0 && invalidItem.sellingPrice > invalidItem.mrp) {
        setEditError('Selling price cannot be greater than MRP.');
      } else {
        setEditError('Item discount cannot be greater than the item selling amount.');
      }
      return;
    }

    if (editTotals.flatDiscountAmount < 0) return setEditError('Flat discount cannot be negative.');
    if (editTotals.flatDiscountAmount > editTotals.preDiscountSubtotal) {
      return setEditError('Flat discount cannot be greater than the subtotal.');
    }

    setEditSaving(true);

    try {
      await updateBillingInvoice(editInvoice.invoice_number, {
        doctorName: editForm.doctorName.trim() || undefined,
        paymentType: editForm.paymentType || 'Cash',
        customerName: editForm.customerName.trim() || undefined,
        phoneNumber: editForm.phoneNumber.trim() || undefined,
        patientAge: editForm.patientAge === '' ? null : Number(editForm.patientAge),
        patientGender: editForm.patientGender || undefined,
        address: editForm.address.trim() || undefined,
        gstin: editForm.gstin.trim() || undefined,
        taxBreakdown: editTotals.gstBreakdown,
        totalQuantity: editTotals.totalQuantity,
        grossAmount: editTotals.grossAmount,
        discountAmount: editTotals.discount,
        subtotal: editTotals.beforeRound,
        flatDiscount: editTotals.flatDiscountAmount,
        finalPayable: editTotals.payable,
        items: editTotals.calculated.map((item) => ({
          medicineId: item.medicineId,
          medicineName: item.medicineName.trim(),
          batch: item.batch.trim(),
          expiryDate: `${item.expiryDate}-01`,
          qty: item.qty,
          pack: item.pack,
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
      setEditInvoice(null);
      setRefreshKey((key) => key + 1);
      notifications.show({
        title: 'Invoice updated',
        message: 'Invoice details have been successfully updated.',
        color: 'teal',
        icon: <IconCircleCheck size={18} />,
      });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update invoice.');
    } finally {
      setEditSaving(false);
    }
  };


  const invoice = viewDetail?.invoice ?? viewInvoice;
  const items = viewDetail?.items ?? [];

  return (
    <Container fluid px={0} py="md">
      <Stack gap={4} mb="lg">
        <Title order={2}>Billing Invoices</Title>
        <Text c="dimmed" size="sm">
          Browse and review every pharmacy invoice you have generated.
        </Text>
      </Stack>

      <Paper withBorder radius="md" p="md" shadow="xs" mb="md">
        <Group align="flex-end" gap="md" style={{ width: '100%', flexWrap: 'nowrap' }}>
          <Group grow style={{ flex: 1 }} align="flex-end">
            <TextInput
              label="Search"
              placeholder="Search by invoice number, customer, doctor or payment type..."
              leftSection={<IconSearch size={16} />}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
            />

          </Group>
         <Button
      leftSection={<IconPlus size={16} />}
      variant="filled"
      color="blue"
      h={36}
      mt={22}
      onClick={() => navigate('/billing')}
    >
      Add Billing Invoice
    </Button>
          <ActionIcon
            variant="light"
            color="blue"
            size="lg"
            mt={22}
            onClick={() => setRefreshKey((key) => key + 1)}
            title="Refresh invoices"
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </Group>
      </Paper>

      <Paper withBorder radius="md" p="md" shadow="xs">
        <Group justify="space-between" mb="md">
          <Title order={4}>Invoices</Title>
          <Text size="sm" c="dimmed">
            {loading
              ? 'Loading records…'
              : `${filteredRecords.length} of ${totalRecords} invoice${totalRecords === 1 ? '' : 's'} found`}
          </Text>
        </Group>

        {error && (
          <Alert
            icon={<IconAlertCircle size={18} />}
            color="red"
            variant="light"
            title="Unable to load invoices"
            radius="md"
            mb="md"
          >
            {error} Please verify the API server is running at {API_BASE_URL}.
          </Alert>
        )}

        <ScrollArea h={550} offsetScrollbars type="scroll" scrollbarSize={8}>
          <Table
            striped
            highlightOnHover
            verticalSpacing="sm"
            horizontalSpacing="md"
            withTableBorder
            stickyHeader
            style={{ fontSize: '75%' }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Invoice No.</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Customer</Table.Th>
                <Table.Th>Doctor</Table.Th>
                <Table.Th>Payment</Table.Th>
                <Table.Th ta="right">GST</Table.Th>
                <Table.Th ta="right">Total Discount</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th ta="center">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loading &&
                Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
                  <Table.Tr key={`skeleton-${rowIndex}`}>
                    {Array.from({ length: TABLE_COLUMN_COUNT }).map((__, colIndex) => (
                      <Table.Td key={colIndex}>
                        <Skeleton height={16} radius="sm" />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}

              {!loading && !error && filteredRecords.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={TABLE_COLUMN_COUNT}>
                    <Stack align="center" gap={4} py="xl">
                      <IconInbox size={28} color="var(--mantine-color-gray-5)" />
                      <Text c="dimmed" size="sm">
                        No invoices match your current filters.
                      </Text>
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              )}

              {!loading &&
                !error &&
                filteredRecords.map((row) => (
                  <Table.Tr key={row.invoice_number}>
                    <Table.Td>
                      <b>{row.invoice_number}</b>
                    </Table.Td>
                    <Table.Td>{formatInvoiceDate(row.invoice_date)}</Table.Td>
                    <Table.Td>{row.customer_name || '—'}</Table.Td>
                    <Table.Td>{row.doctor_name || '—'}</Table.Td>
                    <Table.Td>
                      <PaymentBadge paymentType={row.payment_type} />
                    </Table.Td>
                    <Table.Td ta="right" fw={500}>
                      {money(getInvoiceGst(row))}
                    </Table.Td>
                    <Table.Td ta="right" c="red.7" fw={500}>
                      −{money(Number(row.discount_amount ?? 0) + Number(row.flat_discount ?? 0))}
                    </Table.Td>
                   
                    <Table.Td ta="right" fw={600}>
                      {money(row.final_payable)}
                    </Table.Td>
                    <Table.Td>
                      <Group justify="center" gap={4} wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="sm"
                          onClick={() => openView(row)}
                          title="View invoice"
                        >
                          <IconEye style={{ width: 16, height: 16 }} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="teal"
                          size="sm"
                          onClick={() => openEdit(row)}
                          title="Modify invoice"
                        >
                          <IconPencil style={{ width: 16, height: 16 }} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="violet"
                          size="sm"
                          onClick={() => openPrint(row)}
                          title="Print / download invoice"
                        >
                          <IconPrinter style={{ width: 16, height: 16 }} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Group justify="space-between" mt="md">
          <Select
            value={String(pageSize)}
            onChange={(value) => setPageSize(Number(value) || 10)}
            data={['5', '10', '20', '50']}
            leftSection={<IconListDetails size={16} />}
            w={90}
            size="sm"
            radius="md"
            allowDeselect={false}
          />
          {totalPages > 1 && (
            <Pagination
              total={totalPages}
              value={activePage}
              onChange={setActivePage}
              size="sm"
              boundaries={1}
              siblings={1}
            />
          )}
        </Group>
      </Paper>

      {/* ------------------------------ View modal ------------------------------ */}
      <Modal
        opened={!!viewInvoice}
        onClose={() => setViewInvoice(null)}
        title={
          <Group gap="xs">
            <IconReceipt size={18} />
            <Text fw={700}>{viewInvoice?.invoice_number}</Text>
          </Group>
        }
        size={960}
        centered
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      >
        {viewLoading && (
          <Stack gap="xs">
            <Skeleton height={16} radius="sm" />
            <Skeleton height={16} radius="sm" />
            <Skeleton height={16} radius="sm" />
          </Stack>
        )}

        {viewError && !viewLoading && (
          <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light" radius="md">
            {viewError}
          </Alert>
        )}

        {!viewLoading && !viewError && invoice && (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 2, sm: 3 }}>
              <div>
                <Text size="xs" c="dimmed">Invoice date</Text>
                <Text fw={600}>{formatInvoiceDate(invoice.invoice_date)}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Payment type</Text>
                <PaymentBadge paymentType={invoice.payment_type} />
              </div>
              <div>
                <Text size="xs" c="dimmed">Created by</Text>
                <Text fw={600}>{invoice.created_by || '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Customer</Text>
                <Text fw={600}>{invoice.customer_name || '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Doctor</Text>
                <Text fw={600}>{invoice.doctor_name || '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Phone</Text>
                <Text fw={600}>{invoice.phone_number || '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Age / Gender</Text>
                <Text fw={600}>
                  {invoice.patient_age != null ? `${invoice.patient_age} yrs` : '—'}
                  {invoice.patient_gender ? ` · ${invoice.patient_gender}` : ''}
                </Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">GSTIN</Text>
                <Text fw={600}>{invoice.gstin || '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Address</Text>
                <Text fw={600}>{invoice.address || '—'}</Text>
              </div>
            </SimpleGrid>

            <Divider />

            <ScrollArea offsetScrollbars scrollbarSize={8}>
              <Table striped withTableBorder verticalSpacing="xs" horizontalSpacing="xs" fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Medicine</Table.Th>
                    <Table.Th>Batch</Table.Th>
                    <Table.Th>Expiry</Table.Th>
                    <Table.Th ta="right">Qty</Table.Th>
                    <Table.Th>Pack</Table.Th>
                    <Table.Th ta="right">MRP</Table.Th>
                    <Table.Th ta="right">Selling</Table.Th>
                    <Table.Th ta="right">GST %</Table.Th>
                    <Table.Th ta="right">Taxable</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={10}>
                        <Text c="dimmed" ta="center" py="md">
                          No line items recorded for this invoice.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {items.map((item: BillingInvoiceItem) => (
                    <Table.Tr key={item.item_id}>
                      <Table.Td>
                        <b>{item.medicine_name}</b>
                      </Table.Td>
                      <Table.Td>{item.batch}</Table.Td>
                      <Table.Td>{formatInvoiceDate(item.expiry_date)}</Table.Td>
                      <Table.Td ta="right">{item.qty}</Table.Td>
                      <Table.Td>{item.pack}</Table.Td>
                      <Table.Td ta="right">{money(item.mrp)}</Table.Td>
                      <Table.Td ta="right">{money(item.selling_price)}</Table.Td>
                      <Table.Td ta="right">{Number(item.gst_percentage ?? 0)}%</Table.Td>
                      <Table.Td ta="right">{money(item.taxable_amount)}</Table.Td>
                      <Table.Td ta="right">{money(item.total)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            <Divider />

            <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="lg" verticalSpacing="md">
              <div>
                <Text size="xs" c="dimmed" fw={500} tt="uppercase" lts={0.5}>
                  Total quantity
                </Text>
                <Text size="sm" fw={600} mt={2}>
                  {invoice.total_quantity ?? 0}
                </Text>
              </div>

              <div>
                <Text size="xs" c="dimmed" fw={500} tt="uppercase" lts={0.5}>
                  Gross amount
                </Text>
                <Text size="sm" fw={600} mt={2}>
                  {money(invoice.gross_amount)}
                </Text>
              </div>

              <div>
                <Text size="xs" c="dimmed" fw={500} tt="uppercase" lts={0.5}>
                  Item Discount
                </Text>
                <Text size="sm" fw={600} c="red.6" mt={2}>
                  -{money(invoice.discount_amount)}
                </Text>
              </div>

              <div>
                <Text size="xs" c="dimmed" fw={500} tt="uppercase" lts={0.5}>
                  Flat discount
                </Text>
                <Text size="sm" fw={600} c="red.6" mt={2}>
                  -{money(invoice.flat_discount)}
                </Text>
              </div>

              <div>
                <Text size="xs" c="dimmed" fw={500} tt="uppercase" lts={0.5}>
                  Total Discount
                </Text>
                <Text size="sm" fw={600} c="red.7" mt={2}>
                  -{money((Number(invoice.discount_amount) || 0) + (Number(invoice.flat_discount) || 0))}
                </Text>
              </div>

              <div>
                <Text size="xs" c="dimmed" fw={500} tt="uppercase" lts={0.5}>
                  Final payable
                </Text>
                <Text size="md" fw={700} c="blue.7" mt={2}>
                  {money(invoice.final_payable)}
                </Text>
              </div>
            </SimpleGrid>
          </Stack>
        )}

        <Group justify="flex-end" mt="lg">
          <Button variant="light" color="gray" onClick={() => setViewInvoice(null)}>
            Close
          </Button>
        </Group>
      </Modal>

      {/* ------------------------------ Edit modal ------------------------------ */}
      <Modal
        opened={!!editInvoice}
        onClose={() => setEditInvoice(null)}
        title={
          <Group gap="xs">
            <IconPencil size={18} />
            <Text fw={700}>Modify {editInvoice?.invoice_number}</Text>
          </Group>
        }
        size={960}
        centered
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      >
        <Stack gap="md">
          {editError && (
            <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light" radius="md">
              {editError}
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Customer name"
              placeholder="Full name"
              value={editForm.customerName ?? ''}
              onChange={(event) => setField('customerName', event.currentTarget.value)}
            />
            <TextInput
              label="Doctor name"
              placeholder="Dr. Name"
              value={editForm.doctorName ?? ''}
              onChange={(event) => setField('doctorName', event.currentTarget.value)}
            />
            <Select
              label="Payment type"
              data={['Cash', 'UPI', 'Card', 'Credit']}
              value={editForm.paymentType ?? 'Cash'}
              onChange={(value) => setField('paymentType', value ?? 'Cash')}
            />
            <TextInput
              label="Phone number"
              placeholder="10-digit mobile number"
              value={editForm.phoneNumber ?? ''}
              onChange={(event) => setField('phoneNumber', event.currentTarget.value)}
            />
            <TextInput
              label="Age"
              placeholder="Years"
              value={editForm.patientAge ?? ''}
              onChange={(event) => setField('patientAge', event.currentTarget.value)}
            />
            <Select
              label="Gender"
              placeholder="Select gender"
              data={['Female', 'Male', 'Other', 'Prefer not to say']}
              value={editForm.patientGender ?? null}
              onChange={(value) => setField('patientGender', value ?? '')}
            />
            <TextInput
              label="GSTIN"
              placeholder="For business customers"
              value={editForm.gstin ?? ''}
              onChange={(event) => setField('gstin', event.currentTarget.value)}
            />
            <TextInput
              label="Address"
              placeholder="Billing address"
              value={editForm.address ?? ''}
              onChange={(event) => setField('address', event.currentTarget.value)}
            />
          </SimpleGrid>

          <Divider />

          <Group justify="space-between">
            <Text fw={600}>Medicine items</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addEditItem}>
              Add medicine
            </Button>
          </Group>

          {editItemsLoading && (
            <Stack gap="xs">
              <Skeleton height={16} radius="sm" />
              <Skeleton height={16} radius="sm" />
            </Stack>
          )}

          {!editItemsLoading && (
            <ScrollArea offsetScrollbars scrollbarSize={8}>
              <Table striped withTableBorder verticalSpacing="xs" horizontalSpacing="xs" fz="xs" miw={900}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Medicine</Table.Th>
                    <Table.Th>Batch</Table.Th>
                    <Table.Th>Expiry</Table.Th>
                    <Table.Th>HSN code</Table.Th>
                    <Table.Th ta="right">Qty</Table.Th>
                    <Table.Th>Pack</Table.Th>
                    <Table.Th ta="right">MRP</Table.Th>
                    <Table.Th ta="right">Selling</Table.Th>
                    <Table.Th w={40}></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {editItems.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Autocomplete
                          size="xs"
                          placeholder="Medicine name"
                          error={submitAttempted && !item.medicineName.trim()}
                          value={item.medicineName}
                          data={(editMedicineSuggestions[item.id] || []).map((med) => ({
                            value: `${med.name}__${med.sku_id}`,
                            label: med.name,
                          }))}
                          onChange={(value) => {
                            const cleanName = value.includes('__') ? value.split('__')[0] : value;
                            handleEditMedicineNameSearch(item.id, cleanName);
                          }}
                          onOptionSubmit={(selectedValue) => {
                            const [selectedName, selectedId] = selectedValue.split('__');
                            handleEditMedicineSelect(item.id, Number(selectedId), selectedName);
                          }}
                          rightSection={editMedicineSearchLoading[item.id] ? <Loader size="xs" /> : null}
                          comboboxProps={{ withinPortal: true, width: 300, position: 'bottom-start', offset: 2 }}
                          ref={(input) => { medicineNameRefs.current[item.id] = input; }}
                          renderOption={({ option }) => {
                            const [name, medId] = option.value.split('__');
                            const med = (editMedicineSuggestions[item.id] || []).find(
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
                      </Table.Td>
                      <Table.Td>
                        <Autocomplete
                          size="xs"
                          placeholder="Select or enter batch"
                          error={submitAttempted && !item.batch.trim()}
                          data={(editBatchOptions[item.id] || []).map((batch) => batch.batchNumber)}
                          value={item.batch}
                          filter={({ options }) => options}
                          onChange={(value) => updateEditItem(item.id, 'batch', value)}
                          onOptionSubmit={(value) => handleEditBatchSelect(item.id, value)}
                          rightSection={editBatchLoading[item.id] ? <Loader size="xs" /> : null}
                          comboboxProps={{ withinPortal: true }}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Table.Td><TextInput size="xs" type="month" value={item.expiryDate} onChange={(event) => updateEditItem(item.id, 'expiryDate', event.currentTarget.value)} error={!!getExpiryError(item.expiryDate) || (submitAttempted && !item.expiryDate)} styles={{ input: { paddingInline: 6 } }} /></Table.Td>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          placeholder="Select HSN"
                          searchable
                          data={HSN_OPTIONS}
                          value={item.hsnCode}
                          error={submitAttempted && !item.hsnCode.trim()}
                          onChange={(value) => updateEditItem(item.id, 'hsnCode', value ?? '')}
                        />
                      </Table.Td>
                      <Table.Td ta="right">
                        <NumberInput
                          size="xs"
                          min={1}
                          value={item.qty}
                          onChange={(value) => updateEditItem(item.id, 'qty', Number(value) || 0)}
                          hideControls
                        />
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          size="xs"
                          value={item.pack}
                          onChange={(event) => updateEditItem(item.id, 'pack', event.currentTarget.value)}
                        />
                      </Table.Td>
                      <Table.Td ta="right">
                        <NumberInput
                          size="xs"
                          min={0}
                          decimalScale={2}
                          value={item.mrp}
                          onChange={(value) => updateEditItem(item.id, 'mrp', Number(value) || 0)}
                          hideControls
                        />
                      </Table.Td>
                      <Table.Td ta="right">
                        <NumberInput
                          size="xs"
                          min={0}
                          decimalScale={2}
                          error={submitAttempted && (item.sellingPrice > item.mrp || item.sellingPrice <= 0)}
                          value={item.sellingPrice}
                          onChange={(value) => updateEditItem(item.id, 'sellingPrice', Number(value) || 0)}
                          hideControls
                        />
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={() => removeEditItem(item.id)}
                          disabled={editItems.length <= 1}
                          title="Remove item"
                        >
                          <IconTrash style={{ width: 16, height: 16 }} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}

          <Divider />

          <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="md" verticalSpacing="sm" >
            <div>
              <Text size="xs" c="dimmed">Total quantity</Text>
              <Text fw={600} size="sm" lh="xs" style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                {editTotals.totalQuantity}
              </Text>
            </div>

            <div>
              <Text size="xs" c="dimmed">Gross Amount</Text>
              <Text fw={600} size="sm" lh="xs" style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                {money(editTotals.grossAmount)}
              </Text>
            </div>

            <div>
              <Text size="xs" c="dimmed">Item Discount</Text>
              <Text fw={600} size="sm" lh="xs" style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                {money(editTotals.discount ?? 0)}
              </Text>
            </div>

            {/* Compact & Seamless Input Variant */}
            <NumberInput
              label="Flat discount"
              prefix="₹"
              min={0}
              decimalScale={2}
              size="xs"
              variant="filled"
              value={editForm.flatDiscount ?? 0}
              onChange={(value) => setField('flatDiscount', String(value ?? 0))}
              hideControls
              styles={{
                label: { fontWeight: 400, color: 'var(--mantine-color-dimmed)' },
                input: { fontWeight: 600, fontSize: 'var(--mantine-font-size-sm)' },
              }}
            />

            <div>
              <Text size="xs" c="dimmed">Total Discount</Text>
              <Text fw={600} size="sm" lh="xs" style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                {money((Number(editTotals.discount) || 0) + (Number(editForm.flatDiscount) || 0))}
              </Text>
            </div>

            <div>
              <Text size="xs" c="dimmed">Final payable</Text>
              <Text fw={700} size="sm" lh="xs" c="blue" style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                {money(editTotals.payable)}
              </Text>
            </div>
          </SimpleGrid>
        </Stack>

        <Group justify="flex-end" gap="sm" mt="lg">
          <Button variant="light" color="gray" onClick={() => setEditInvoice(null)}>
            Cancel
          </Button>
          <Button color="blue" onClick={handleSaveEdit} loading={editSaving} disabled={editSaving || editItemsLoading}>
            Save changes
          </Button>
        </Group>
      </Modal>

      {/* ------------------------------ Print / PDF preview modal ------------------------------ */}
      <Modal
        opened={!!printInvoice}
        onClose={() => setPrintInvoice(null)}
        title={
          <Group gap="xs">
            <IconPrinter size={18} />
            <Text fw={700}>Print preview · {printInvoice?.invoice_number}</Text>
          </Group>
        }
        size={980}
        centered
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      >
        {printLoading && (
          <Stack gap="xs">
            <Skeleton height={16} radius="sm" />
            <Skeleton height={16} radius="sm" />
            <Skeleton height={16} radius="sm" />
          </Stack>
        )}

        {printError && !printLoading && (
          <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light" radius="md">
            {printError}
          </Alert>
        )}

        {!printLoading && !printError && printDetail && (
          <ScrollArea h={600} offsetScrollbars scrollbarSize={8}>
            <div style={{ background: '#e2e8f0', padding: 16, borderRadius: 8 }}>
              <div style={{ boxShadow: '0 8px 30px rgba(15, 23, 42, 0.18)' }}>
                <InvoicePrint ref={printRef} invoice={printDetail.invoice} items={printDetail.items} />
              </div>
            </div>
          </ScrollArea>
        )}

        <Group justify="flex-end" gap="sm" mt="lg">
          <Button variant="light" color="gray" onClick={() => setPrintInvoice(null)}>
            Close
          </Button>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={handleDownloadPdf}
            loading={pdfLoading}
            disabled={pdfLoading || !printDetail || printLoading}
          >
            Download PDF
          </Button>
          <Button
            color="blue"
            leftSection={<IconPrinter size={16} />}
            onClick={handlePrintInvoice}
            disabled={!printDetail || printLoading}
          >
            Print
          </Button>
        </Group>
      </Modal>
    </Container>
  );
}
