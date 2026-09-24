import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Textarea,
  SimpleGrid,
  Flex,
  Stack,
  Box,
  TextInput,
  NumberInput,
  Autocomplete,
  Select,
  Text,
  Group,
  Button,
  ThemeIcon,
  Divider,
  Loader,
  Tooltip 
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconCheck,
  IconPill,
  IconFlask,
  IconCoins,
  IconCalendarEvent,
  IconInfoCircle,
  IconPhotoOff,
  IconX
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { debounce } from '../utils/debounce';
import { addInventory, type InventoryItem } from '../services/inventory';
import { getMedicineByName, type Medicine } from '../services/medicine';
import { getManufacturerName, type Manufacturer } from '../services/manufacturer';

// Canonical medicine categories. MUST match the <Select data> options below.
const MEDICINE_TYPES = ['Allopathy', 'Ayurvedic', 'Homeopathy', 'Surgical', 'Other'];

/**
 * Below this width the form modal goes full screen. A 80%-wide, 1,100px-tall
 * dialog is unusable on a phone, and `Modal`'s `size` prop is *not* a style
 * prop, so it cannot take a responsive object — this is the one structural
 * change that genuinely needs a media query.
 */
const MOBILE_MODAL_QUERY = '(max-width: 48em)';
/** Horizontal/vertical modal gutters, in px, per viewport. */
const MODAL_PAD_DESKTOP = 32;
const MODAL_PAD_MOBILE = 16;

/**
 * Normalizes any incoming medicine type value to a canonical Select option.
 * The medicine database stores types in lowercase (e.g. "allopathy"), while the
 * Select options are Title Case ("Allopathy"). Without normalization the Select
 * cannot match the value to an option and renders blank.
 */
const normalizeMedicineType = (value?: string | null): string => {
  if (!value || !value.trim()) return MEDICINE_TYPES[0];
  const trimmed = value.trim();
  const match = MEDICINE_TYPES.find(
    (option) => option.toLowerCase() === trimmed.toLowerCase()
  );
  // Keep unknown values as-is so no data is silently lost.
  return match ?? trimmed;
};

/**
 * Converts whatever the backend returns for `expiry_date` into the
 * `YYYY-MM-DD` string an `<input type="date">` expects.
 *
 * Deliberately does not use `new Date(value).toISOString()`: that converts to
 * UTC, so a local-midnight timestamp in a positive-offset timezone (IST, +5:30)
 * reads back as the previous day and editing a batch silently shifts its expiry.
 */
const toDateInputValue = (value?: string | number | null): string => {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();

  // Already a calendar date (with or without a time part) — trust it verbatim.
  const calendarDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (calendarDate) return calendarDate[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  // Fall back to local calendar parts rather than the UTC ISO date.
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
};

interface InventoryModalFormProps {
  opened: boolean;
  onClose: () => void;
  initialData?: any;
  onSuccess?: () => void;
}

export default function InventoryModalForm({
  opened,
  onClose,
  initialData,
  onSuccess
}: InventoryModalFormProps) {
  // --- STATES ---
  const [quantity, setQuantity] = useState<number | string>(1);
  const [alertthreshold, setAlertThreshold] = useState<number | string>(6);
  const [medicineName, setMedicineName] = useState('');
  const [composition1, setComposition1] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [packsize, setPackSize] = useState<number | string>('');
  const [batchNumber, setBatchNumber] = useState('');
  const [shelfrackinfo, setshelfrackinfo] = useState('');
  const [purchasePrice, setPurchasePrice] = useState<number | string>(0);
  const [sellingPrice, setSellingPrice] = useState<number | string>(0);
  const [mrp, setMrp] = useState<number | string>(0);
  const [imageurl, setImageUrl] = useState<string>('');
  const [medicineType, setMedicineType] = useState('');
  const [expiryDate, setExpiryDate] = useState<string>('');

  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [warningModalOpened, setWarningModalOpened] = useState<boolean>(false);

  // --- RESPONSIVE LAYOUT ---
  // Only used for the two things CSS alone cannot express: the modal's
  // `fullScreen` switch and the px-precise math behind the sticky action bar.
  const isMobileModal = useMediaQuery(MOBILE_MODAL_QUERY);
  const modalPad = isMobileModal ? MODAL_PAD_MOBILE : MODAL_PAD_DESKTOP;

  // --- API FETCHING STATES ---
  const [suggestions, setSuggestions] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setSelectedMedicine] = useState<Medicine | null>(null);
  const [confirmedManufacturer, setConfirmedManufacturer] = useState<string>('');
  const [manufacturerSuggestions, setManufacturerSuggestions] = useState<Manufacturer[]>([]);
  const [manufacturerLoading, setManufacturerLoading] = useState(false);
  const [, setError] = useState<string | null>(null);

  const [originalIdentity, setOriginalIdentity] = useState<{
    name: string;
    manufacturer: string;
    packsize: string;
    composition1: string;
    batchNumber: string;
  } | null>(null);


  // --- STRICT VALIDATION RULES ---
  const isMedicineNameValid = medicineName.trim().length > 0 && medicineName.length <= 500;
  const isManufacturerValid = manufacturer.trim().length > 0 && manufacturer.length <= 500;
  const isTypeValid = !!medicineType && medicineType.trim().length > 0;
  const isBatchNumberValid = batchNumber.trim().length > 0 && batchNumber.length <= 100;
  const isQuantityValid = quantity !== '' && Number(quantity) > 0;
  const isExpiryDateValid = expiryDate.trim().length > 0;
  const isSellingPriceValid = sellingPrice !== '' && Number(sellingPrice) > 0;
  const isMrpValid = mrp !== '' && Number(mrp) > 0;

  const isFormValid =
    isMedicineNameValid &&
    isManufacturerValid &&
    isTypeValid &&
    isBatchNumberValid &&
    isQuantityValid &&
    isExpiryDateValid &&
    isSellingPriceValid &&
    isMrpValid;

  const isMissingWarningFields = (Number(purchasePrice) <= 0) || (composition1.trim().length === 0);

  // --- API DEBOUNCE & FETCH LOGIC ---
  const useDebouncedSearch = (
    apiFunction: (query: string) => Promise<any>,
    setSuggestions: (data: any[]) => void,
    setLoading: (loading: boolean) => void,
    setError: (error: string | null) => void,
    emptyValue: () => void = () => { }
  ) => {
    const debouncedSearch = useCallback(
      debounce(async (name: string, isSelection: boolean = false) => {
        if (isSelection || !name.trim()) {
          emptyValue();
          setLoading(false);
          return;
        }

        setLoading(true);
        try {
          const response = await apiFunction(name);
          setSuggestions(response.data || []);
          setError(null);
        } catch {
          setSuggestions([]);
          setError('Failed to fetch data. Please try again.');
        } finally {
          setLoading(false);
        }
      }, 1000),
      [apiFunction]
    );

    // Drop any pending timer when the searcher is replaced or unmounted, so a
    // lookup cannot resolve into a form that has already closed.
    useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

    return debouncedSearch;
  };

  const debouncedSearch = useDebouncedSearch(
    getMedicineByName,
    setSuggestions,
    setLoading,
    setError,
    () => setSuggestions([])
  );

  const debouncedManufacturerSearch = useDebouncedSearch(
    getManufacturerName,
    setManufacturerSuggestions,
    setManufacturerLoading,
    setError,
    () => setManufacturerSuggestions([])
  );

  const handleMedicineNameChange = (value: string) => {
    setMedicineName(value);
  };
  
  const handleMedicineSelect = (medicine: Medicine) => {
    setSelectedMedicine(medicine);
    setComposition1(medicine.short_composition || '');
    setPackSize(medicine.pack_size_label || '');
    setMrp(medicine.price || 0);
   
    setImageUrl(medicine.image_url || '');

    setMedicineType(normalizeMedicineType(medicine.type));
    setManufacturer(medicine.manufacturer_name || '');
    setConfirmedManufacturer(medicine.manufacturer_name || '');

    setLoading(false);
    setSuggestions([]);
  };

  const handleManufacturerNameChange = (value: string) => {
    setManufacturer(value);
    setConfirmedManufacturer(''); // Clear confirmation because user is typing a new search
    if (!value.trim()) {
      setManufacturerSuggestions([]);
      setManufacturerLoading(false);
      return;
    }
    debouncedManufacturerSearch(value);
  };

  const handleManufacturerSelect = (manufacturerName: string) => {
    setManufacturer(manufacturerName);
    setConfirmedManufacturer(manufacturerName); // Confirm the selection
    setManufacturerSuggestions([]);
    setManufacturerLoading(false);
  };

  /**
   * Restores every field to the "new stock item" defaults.
   *
   * Memoized because the hydration effect below calls it: an unstable identity
   * would make that effect re-run on every render and overwrite whatever the
   * user had typed.
   */
  const resetFormFields = useCallback(() => {
    setMedicineName('');
    setComposition1('');
    setManufacturer('');
    setQuantity(1);
    setBatchNumber('');
    setshelfrackinfo('');
    setAlertThreshold(6);
    setPackSize('');
    setImageUrl('');
    setPurchasePrice(0);
    setSellingPrice(0);
    setMrp(0);
    setExpiryDate('');
    setMedicineType('Allopathy');
    setIsSubmitted(false);
    setWarningModalOpened(false);
    setSuggestions([]);
    setManufacturerSuggestions([]);
    setSelectedMedicine(null);
    setConfirmedManufacturer('');
  }, []);

  // --- LIFECYCLE & SUBMISSION ---
  /**
   * Hydrates the form for the record the modal is showing, then fills in the
   * one field the inventory payload cannot supply.
   *
   * Why this is deliberately one effect and not two: both steps write the same
   * form state, and they must happen in a fixed order — clear the preview,
   * then (edit mode only) re-resolve it from the medicine catalogue, because
   * `/inventory/get-inventory` returns stock columns only and carries no
   * `image_url` while images live on the catalogue. Two effects with identical
   * deps made that order implicit in their declaration order, so correctness
   * depended on nobody ever reordering the file, and left two writers racing
   * to own `imageUrl`. One effect, one cancellation flag, one owner.
   */
  useEffect(() => {
    if (!opened) return;

    // Transient state from a previous open must never bleed into this one:
    // stale red validation borders, a stale warning dialog, stale autocomplete
    // suggestions, or a stale package photo.
    setIsSubmitted(false);
    setWarningModalOpened(false);
    setSuggestions([]);
    setManufacturerSuggestions([]);
    setSelectedMedicine(null);
    setLoading(false);
    setManufacturerLoading(false);
    setError(null);

    if (!initialData) {
      setOriginalIdentity(null);
      resetFormFields();
      return;
    }

    const initialManufacturer =
      initialData.manufacturername || initialData.manufacturer_name || '';

    setMedicineName(initialData.name || '');
    setManufacturer(initialManufacturer);
    // Marked confirmed up front so the "0 records found" hint stays hidden for
    // a value that came from the database rather than from typing.
    setConfirmedManufacturer(initialManufacturer);
    setMedicineType(normalizeMedicineType(initialData.type));
    setPackSize(initialData.pack_size_label || '');
    setComposition1(initialData.composition1 || '');
    setMrp(initialData.mrp || 0);
    setBatchNumber(initialData.batch_number || '');
    setshelfrackinfo(initialData.shelf_rack_info || '');
    setQuantity(initialData.stock_quantity || 0);
    setPurchasePrice(initialData.purchase_price || 0);
    setSellingPrice(initialData.selling_price || 0);
    setAlertThreshold(initialData.stock_alert_threshold || 6);
    setExpiryDate(toDateInputValue(initialData.expiry_date));
    setImageUrl(initialData.image_url || '');

    setOriginalIdentity({
      name: initialData.name || '',
      manufacturer: initialManufacturer,
      packsize: (initialData.pack_size_label ?? '').toString(),
      composition1: initialData.composition1 || '',
      batchNumber: initialData.batch_number,
    });

    // Some payloads already carry the image; only hit the catalogue if not.
    const lookupName = initialData.image_url ? '' : (initialData.name || '').trim();
    if (!lookupName) return;

    let ignore = false;

    void (async () => {
      try {
        const response = await getMedicineByName(lookupName);
        if (ignore) return;

        const matches = response.data || [];
        // Exact name match first, so a fuzzy suggestion cannot swap the image.
        const exact = matches.find(
          (med) => (med.name || '').trim().toLowerCase() === lookupName.toLowerCase()
        );

        // Always assign, including on a miss: a lookup that finds nothing must
        // clear the preview rather than leave the previous record's photo up.
        setImageUrl((exact ?? matches[0])?.image_url || '');
      } catch {
        // A catalogue miss must never block editing — the preview simply stays
        // in its "no image" state, same as a medicine with no image on file.
      }
    })();

    return () => {
      ignore = true;
    };
    // `initialData` is a dependency on purpose so switching records re-hydrates
    // the form; the parent therefore passes a stable row reference (see
    // `handleUpdateRecord` in the inventory page) rather than a fresh object
    // per render, which would wipe in-progress edits.
  }, [initialData, opened, resetFormFields]);

  const handleInitialSubmitCheck = () => {
    setIsSubmitted(true);

    if (!isFormValid) {
      notifications.show({
        title: 'Required Fields Missing',
        message: 'Please fill out all mandatory fields highlighted in red.',
        color: 'red',
        icon: <IconAlertTriangle size={16} />,
      });
      return;
    }

    if (originalIdentity) {
      const identityChanged =
        medicineName !== originalIdentity.name ||
        manufacturer !== originalIdentity.manufacturer ||
        (packsize?.toString() || '') !== originalIdentity.packsize ||
        composition1 !== originalIdentity.composition1 ||
        batchNumber !== originalIdentity.batchNumber;

      if (identityChanged) {
        notifications.show({
          title: 'Locked Records Altered',
          message: 'Core details cannot be altered on active stock items here. Create a new baseline record instead.',
          color: 'red',
          icon: <IconAlertTriangle size={16} />,
        });
        return;
      }
    }

    if (isMissingWarningFields) {
      setWarningModalOpened(true);
      return;
    }

    executeDatabaseInsert();
  };

  const executeDatabaseInsert = async () => {
    setIsSaving(true);
    setWarningModalOpened(false);

    try {
      const item: InventoryItem = {
        name: medicineName,
        manufacturername: manufacturer,
        type: normalizeMedicineType(medicineType),
        packsizelabel: packsize?.toString() || '',
        composition1: composition1 || '',
        mrp: Number(mrp) || 0,
        batchnumber: batchNumber,
        shelfrackinfo: shelfrackinfo,
        stockquantity: Number(quantity) || 0,
        purchaseprice: Number(purchasePrice) || 0,
        sellingprice: Number(sellingPrice) || 0,
        stockalertthreshold: Number(alertthreshold) || 0,
        expirydate: expiryDate || '',
        insertdate: new Date().toISOString(),
        updatedate: new Date().toISOString(),
      };

      await addInventory(item);

      notifications.show({
        title: 'Success!',
        message: initialData ? 'Inventory record updated successfully.' : `${medicineName} saved to registry.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      notifications.show({
        title: 'Server Error Encountered',
        message: err instanceof Error ? err.message : 'Database error encountered while saving layout data.',
        color: 'red',
        icon: <IconAlertTriangle size={16} />,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // --- STYLING ---
  const getInputStyles = (isValid: boolean) => {
    const errorActive = isSubmitted && !isValid;
    return {
      root: { marginBottom: '4px' },
      label: { fontWeight: 600, fontSize: '13px', color: '#334155', marginBottom: '6px' },
      input: {
        height: '42px',
        borderRadius: '10px',
        border: errorActive ? '2px solid #fa5252' : '1px solid #cbd5e1',
        backgroundColor: errorActive ? '#fff5f5' : '#ffffff',
        transition: 'all 0.2s ease',
        '&:focus': {
          borderColor: errorActive ? '#fa5252' : '#228be6',
          boxShadow: errorActive ? '0 0 0 3px rgba(250, 82, 82, 0.15)' : '0 0 0 3px rgba(34, 138, 230, 0.1)'
        },
        '&:disabled, &:readOnly': {
          color: '#1e293b',
          backgroundColor: '#eef2f6',
          cursor: 'not-allowed'
        }
      },
      error: { color: '#fa5252', fontSize: '11px', marginTop: '4px', fontWeight: 500 }
    };
  };

  const getWarningFieldStyles = (isEmpty: boolean) => {
    const warningActive = isSubmitted && isEmpty;
    return {
      root: { marginBottom: '4px' },
      label: { fontWeight: 600, fontSize: '13px', color: '#334155', marginBottom: '6px' },
      input: {
        height: '42px',
        borderRadius: '10px',
        border: warningActive ? '2px solid #fab005' : '1px solid #cbd5e1',
        backgroundColor: warningActive ? '#fff9db' : '#ffffff',
        transition: 'all 0.2s ease',
        '&:focus': { borderColor: warningActive ? '#fab005' : '#228be6' }
      }
    };
  };

  const renderLabelWithTooltip = (label: string, helpText: string) => (
    <Box
      component="span"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        verticalAlign: 'middle'
      }}
    >
      <Text component="span" size="sm" fw={500} c="#334155" style={{ lineHeight: 1.2 }}>
        {label}
      </Text>
      <Tooltip label={helpText} withArrow position="top-start" multiline w={260}>
        <ThemeIcon
          component="span"
          variant="light"
          size="sm"
          radius="xl"
          color="blue"
          style={{ cursor: 'help', display: 'inline-flex' }}
        >
          <IconInfoCircle size={12} />
        </ThemeIcon>
      </Tooltip>
    </Box>
  );

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        // Phones get the full screen instead of a cramped 80%-wide dialog.
        fullScreen={isMobileModal}
        size="80%"
        radius="24px"
        centered
        withCloseButton
        padding={`${modalPad}px`}
        title={
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="blue" size="lg" radius="md">
              <IconPill size={20} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Text fw={700} fz={{ base: 'md', sm: 'lg' }} c="#0f172a" style={{ lineHeight: 1.2 }}>
                {initialData ? "Edit Medicine Details" : "Add New Medicine"}
              </Text>
              <Text size="xs" c="slate.5" fw={400} visibleFrom="sm">
                Enter basic medicine details, prices, and locations below.
              </Text>
            </Box>
          </Group>
        }
        styles={{
          // Gutters come from the `padding` prop (surfaced as `--mb-padding`)
          // so they stay in sync with the sticky action bar below.
          header: { backgroundColor: '#ffffff', borderBottom: '1px solid #f1f5f9' },
          close: { color: '#cbd5e1', borderRadius: '50%', '&:hover': { backgroundColor: '#f1f5f9', color: '#0f172a' } },
          body: { backgroundColor: '#f8fafc' },
          overlay: { backdropFilter: 'blur(8px)', backgroundColor: 'rgba(15, 23, 42, 0.25)' }
        }}
      >
        <Flex direction="column" gap={{ base: 'md', md: 'xl' }}>
          {/* SECTION 1: Product Definition */}
          <Box p={{ base: 'md', md: 'lg' }} style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #edf2f7' }}>
            <Group gap="xs" mb="md" wrap="nowrap">
              <IconPill size={16} style={{ color: '#228be6', flexShrink: 0 }} />
              <Text fw={700} size="sm" c="#1e293b">1. Basic Medicine & Batch Details</Text>
            </Group>

            {/* 1 column on phones, 2 on large phones/small tablets, 4 on desktop */}
            <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
              <Box>

                <Autocomplete
                  label={renderLabelWithTooltip(
                    'Medicine Name',
                    'Type the medicine name to search existing records. Choosing a suggestion auto-fills known details like composition and manufacturer.'
                  )}
                  placeholder="Search medicine..."
                  required
                  error={isSubmitted && !isMedicineNameValid ? "Medicine name is required" : null}
                  value={medicineName}
                  onChange={(value) => {
                    handleMedicineNameChange(value);
                    const medicine = suggestions.find(med => med.name === value);
                    if (medicine) {
                      handleMedicineSelect(medicine);
                      setLoading(false);
                      debouncedSearch(value, true);
                    } else {
                      debouncedSearch(value, false);
                    }
                  }}
                  data={suggestions.map((med) => ({
                    value: `${med.name}||id:${med.sku_id}`,
                    label: med.name
                  }))}
                  rightSection={loading ? <Loader size="sm" /> : null}
                  rightSectionWidth={40}
                  styles={getInputStyles(isMedicineNameValid)}
                />
              </Box>

              <NumberInput
                label={renderLabelWithTooltip(
                  'Stock Quantity (Number of Packs)',
                  'Enter how many packs you currently have for this batch. This value is used for available stock calculations and low-stock alerts.'
                )}
                placeholder="Enter pack quantity"
                required
                value={quantity}
                onChange={setQuantity}
                min={0}
                error={isSubmitted && !isQuantityValid ? "Quantity must be greater than 0" : null}
                styles={getInputStyles(isQuantityValid)}
              />

              <TextInput
                label={renderLabelWithTooltip(
                  'Batch Number (Lot No.)',
                  'Use the manufacturer lot or batch code printed on the package. This helps with expiry tracking, recalls, and audit history.'
                )}
                placeholder="e.g. BT-9921"
                required
                error={isSubmitted && !isBatchNumberValid ? "Batch code required" : null}
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.currentTarget.value)}
                styles={getInputStyles(isBatchNumberValid)}
              />

              <TextInput
                type="date"
                label={renderLabelWithTooltip(
                  'Expiry Date',
                  'Select the exact expiry date for this batch so the system can help prevent selling expired stock.'
                )}
                required
                error={isSubmitted && !isExpiryDateValid ? "Select date" : null}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                styles={getInputStyles(isExpiryDateValid)}
                leftSection={<IconCalendarEvent size={16} style={{ color: '#94a3b8' }} />}
              />
            </SimpleGrid>
          </Box>

          {/* SECTION 2: Formulations & Lineage */}
          <Box p={{ base: 'md', md: 'lg' }} style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #edf2f7' }}>
            <Group gap="xs" mb="md" wrap="nowrap">
              <IconFlask size={16} style={{ color: '#228be6', flexShrink: 0 }} />
              <Text fw={700} size="sm" c="#1e293b">2. Category & Manufacturer Info</Text>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              <Box>
                <Autocomplete
                  label={renderLabelWithTooltip(
                    'Manufacturer / Company Name',
                    'Search and select the medicine manufacturer. Using a consistent manufacturer name keeps reports and records clean.'
                  )}
                  placeholder="e.g. Cipla Ltd"
                  error={isSubmitted && !isManufacturerValid ? "Manufacturer required" : null}
                  value={manufacturer}
                  onChange={(value) => {
                    const selectedManufacturer = manufacturerSuggestions.find(m => m.name === value);
                    if (selectedManufacturer) {
                      handleManufacturerSelect(value);
                      return;
                    }
                    handleManufacturerNameChange(value);
                  }}
                  data={manufacturerSuggestions.map(m => m.name)}
                  rightSection={manufacturerLoading ? <Loader size="sm" /> : null}
                  rightSectionWidth={40}
                  styles={getInputStyles(isManufacturerValid)}
                />
                {/* Safe from false positives: Checks against initial data, auto-fill, and selected states */}
                {manufacturer.trim() &&
                  !manufacturerLoading &&
                  manufacturerSuggestions.length === 0 &&
                  manufacturer !== confirmedManufacturer && (
                    <Text size="xs" c="red.6" mt={4} fw={500}>
                      0 records found
                    </Text>
                  )}
              </Box>

              <Select
                label={renderLabelWithTooltip(
                  'Medicine Type (Category)',
                  'Choose the product category for filtering and reporting. Example: Allopathy, Ayurvedic, Homeopathy, or Surgical.'
                )}
                required
                data={MEDICINE_TYPES}
                error={isSubmitted && !isTypeValid ? "Select category" : null}
                value={medicineType}
                onChange={(value) => setMedicineType(value || '')}
                styles={getInputStyles(isTypeValid)}
              />

              <Textarea
                label={renderLabelWithTooltip(
                  'Main Formula / Active Composition',
                  'Add the main active ingredient and strength, such as Paracetamol 650 mg. This helps pharmacists identify substitutes safely.'
                )}
                placeholder="e.g. Paracetamol IP 650mg"
                value={composition1}
                onChange={(e) => setComposition1(e.currentTarget.value)}
                styles={getWarningFieldStyles(composition1.trim().length === 0)}
                minRows={3}
                autosize
              />


            </SimpleGrid>
          </Box>

          {/* SECTION 3: Valuation, Volumes & Assets */}
          <Box p={{ base: 'md', md: 'lg' }} style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #edf2f7' }}>
            <Group gap="xs" mb="lg" wrap="nowrap">
              <IconCoins size={16} style={{ color: '#228be6', flexShrink: 0 }} />
              <Text fw={700} size="sm" c="#1e293b">3. Pricing & Storage Locations</Text>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
              <Stack gap="md">
                <NumberInput
                  label={renderLabelWithTooltip(
                    'Purchase Price / Cost Price (₹)',
                    'Enter the amount paid per pack. This is useful for profit analysis and reorder planning.'
                  )}
                  value={purchasePrice}
                  onChange={setPurchasePrice}
                  min={0}
                  decimalScale={2}
                  styles={getWarningFieldStyles(Number(purchasePrice) <= 0)}
                />
                <NumberInput
                  label={renderLabelWithTooltip(
                    'Selling Price to Customer (₹)',
                    'Set the actual selling price charged to customers for one pack.'
                  )}
                  placeholder="Retail rate"
                  required
                  value={sellingPrice}
                  onChange={setSellingPrice}
                  min={0}
                  decimalScale={2}
                  error={isSubmitted && !isSellingPriceValid ? "Selling price required" : null}
                  styles={getInputStyles(isSellingPriceValid)}
                />
                <NumberInput
                  label={renderLabelWithTooltip(
                    'Maximum Retail Price (MRP ₹)',
                    'Enter the printed MRP from the package. This helps ensure the selling price does not exceed legal retail limits.'
                  )}
                  placeholder="Printed price on pack"
                  required
                  value={mrp}
                  onChange={setMrp}
                  min={0}
                  decimalScale={2}
                  error={isSubmitted && !isMrpValid ? "MRP required" : null}
                  styles={getInputStyles(isMrpValid)}
                />
              </Stack>

              <Stack gap="md">
                <NumberInput
                  label={renderLabelWithTooltip(
                    'Low Stock Alert Threshold',
                    'Set the minimum quantity at which this item should be flagged for restocking.'
                  )}
                  value={alertthreshold}
                  onChange={setAlertThreshold}
                  min={0}
                  styles={getInputStyles(true)}
                />
                <TextInput
                  label={renderLabelWithTooltip(
                    'Pack Size (Units inside 1 item)',
                    'Describe how many units are inside one pack, for example 10 tablets or 100 ml bottle.'
                  )}
                  placeholder="e.g. 10 Tablets / Strip"
                  value={packsize}
                  onChange={(e) => setPackSize(e.currentTarget.value)}
                  styles={getInputStyles(true)}
                />
                <TextInput
                  label={renderLabelWithTooltip(
                    'Storage Location (Shelf / Rack Number)',
                    'Record where this stock is physically stored so staff can locate it quickly during dispensing.'
                  )}
                  placeholder="e.g. A-12, Row 3"
                  value={shelfrackinfo}
                  onChange={(e) => setshelfrackinfo(e.currentTarget.value)}
                  styles={getInputStyles(true)}
                />
              </Stack>

              <Stack gap="xs">
                {renderLabelWithTooltip(
                  'Medicine Package Image',
                  'Package photo to help visual verification during receiving and dispensing.'
                )}
                <Box
                  h={{ base: 180, sm: 230 }}
                  style={{
                    width: '100%',
                    backgroundColor: '#ffffff',
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  {!imageurl && (
                    <Stack align="center" justify="center" gap={6} h="100%">
                      <IconPhotoOff size={22} color="#94a3b8" />
                      <Text size="xs" c="dimmed" ta="center">
                        No package image on file
                      </Text>
                    </Stack>
                  )}
                  {imageurl && (
                    <>
                      <img
                        src={imageurl}
                        alt={`${medicineName || 'Medicine'} package image`}
                        onError={() => setImageUrl('')}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover' // Fills the entire area without white borders around the image
                        }}
                      />
                     
                    </>
                  )}
                </Box>
              </Stack>
            </SimpleGrid>
          </Box>
        </Flex>

        {/*
          Sticky action bar. The modal content is the scroll container, so
          `position: sticky` keeps Save reachable without scrolling past 11
          fields. The negative inline/bottom margins cancel the modal's gutter
          so the bar spans edge-to-edge, and mobile stacks the buttons
          full-width for thumb-sized targets.
        */}
        <Box
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 3,
            marginInline: -modalPad,
            marginBottom: -modalPad,
            marginTop: 24,
            padding: `${Math.round(modalPad * 0.75)}px ${modalPad}px`,
            backgroundColor: '#ffffff',
            borderTop: '1px solid #e2e8f0',
          }}
        >
          <Flex direction={{ base: 'column-reverse', sm: 'row' }} justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              color="gray"
              size="md"
              leftSection={<IconX size={16} />}
              style={{ borderRadius: '10px', color: '#64748b' }}
              w={{ base: '100%', sm: 'auto' }}
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              color="blue"
              size="md"
              leftSection={<IconCheck size={16} />}
              style={{ borderRadius: '10px', fontWeight: 600 }}
              w={{ base: '100%', sm: 'auto' }}
              onClick={handleInitialSubmitCheck}
              loading={isSaving}
            >
              Save Stock Registry
            </Button>
          </Flex>
        </Box>
      </Modal>

      <Modal
        opened={warningModalOpened}
        onClose={() => setWarningModalOpened(false)}
        size="md"
        radius="16px"
        centered
        withCloseButton={false}
        // Small dialogs need less breathing room on a phone.
        padding={isMobileModal ? '20px' : '24px'}
        styles={{
          overlay: {
            backdropFilter: 'blur(4px)',
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
          }
        }}
      >
        <Stack gap="md" align="center" style={{ textAlign: 'center' }}>
          <ThemeIcon variant="light" color="amber" size="xl" radius="50%">
            <IconAlertTriangle size={28} />
          </ThemeIcon>

          <Box>
            <Text fw={700} size="lg" c="#0f172a" mb={6}>
              Missing Recommended Information
            </Text>
            <Text size="sm" c="#64748b" style={{ lineHeight: 1.5 }}>
              You have left <b>Purchase Price</b> or <b>Main Formula</b> completely empty. Do you want to continue saving the stock anyway?
            </Text>
          </Box>

          <Divider color="#f1f5f9" style={{ width: '100%' }} mt="xs" />

          {/* Phones: one full-width button per row. From `xs` up: a 50/50 split. */}
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm" w="100%">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => setWarningModalOpened(false)}
              style={{
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                color: '#000000'
              }}
              h={{ base: 44, sm: 36 }}
            >
              Cancel & Fix
            </Button>
            <Button
              color="gray"
              onClick={executeDatabaseInsert}
              loading={isSaving}
              style={{
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                color: '#000000'
              }}
              h={{ base: 44, sm: 36 }}
            >
              Yes, Save Anyway
            </Button>
          </SimpleGrid>
        </Stack>
      </Modal>
    </>
  );
}