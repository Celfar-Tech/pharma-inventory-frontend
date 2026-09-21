// components/inventory.tsx
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
    Container,
    Paper,
    Stack,
    Flex,
    Group,
    SimpleGrid,
    Title,
    Text,
    TextInput,
    Select,
    Table,
    Badge,
    Skeleton,
    Alert,
    Radio,
    Pagination, Popover, ActionIcon, Modal, Button,
    ThemeIcon,
} from '@mantine/core';
import {
    IconSearch,
    IconAlertCircle,
    IconArrowsSort,
    IconSparkles,
    IconInbox, IconEdit, IconTrash, IconPlus, IconListDetails
} from '@tabler/icons-react';
import { getInventoryList, deleteInventoryItem, type InventoryRecord } from '../services/inventory';
import { API_BASE_URL } from '../services/apiClient';
import AddInventory from './addinventory';
import styles from './inventory.module.css';

type SortOption = 'insert_date' | 'expiry_date' | 'manufacturer_name';

const SORT_OPTIONS: { value: SortOption; label: string; description: string }[] = [
    { value: 'insert_date', label: 'Newest Stock', description: 'Recently added items first' },
    { value: 'expiry_date', label: 'Expiry Date', description: 'Soonest to expire first' },
    { value: 'manufacturer_name', label: 'Manufacturer', description: 'Alphabetical by manufacturer' },
];

const NEW_STOCK_THRESHOLD_DAYS = 7;
const EXPIRY_WARNING_DAYS = 90;
/** Medicine, Manufacturer, Batch, Compound 1, Quantity, Expiry, Status, Actions */
const TABLE_COLUMN_COUNT = 8;
const SKELETON_ROW_COUNT = 6;

/**
 * Minimum width the data grid needs before it starts scrolling *inside* its own
 * container. Below this the table is panned horizontally instead of stretching
 * the whole page — the app shell must never scroll sideways.
 */
const TABLE_MIN_WIDTH = 880;

/** Joins conditional class names (a tiny stand-in for Mantine's `cx`). */
const cn = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

function formatExpiryDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function isNewestStock(insertDateStr: string): boolean {
    const date = new Date(insertDateStr);
    if (Number.isNaN(date.getTime())) return false;
    const diffDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= NEW_STOCK_THRESHOLD_DAYS;
}

type ExpiryTone = 'past' | 'soon' | null;

/** Colours the expiry cell red once lapsed and amber inside the warning window. */
function getExpiryTone(dateStr: string | null): ExpiryTone {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return null;
    const diffDays = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return 'past';
    return diffDays <= EXPIRY_WARNING_DAYS ? 'soon' : null;
}
function renderStatusBadge(row: InventoryRecord) {
    if (row.stock_quantity === 0) {
        return (
            <Badge className={styles.statusBadge} color="red" variant="light" radius="sm">
                Out of Stock
            </Badge>
        );
    }
    if (row.stock_quantity <= (row.stock_alert_threshold ?? 10)) {
        return (
            <Badge className={styles.statusBadge} color="yellow" variant="light" radius="sm">
                Low Stock
            </Badge>
        );
    }
    if (isNewestStock(row.insert_date)) {
        return (
            <Badge className={styles.statusBadge} color="blue" variant="filled" radius="sm" leftSection={<IconSparkles size={12} />}>
                Newest
            </Badge>
        );
    }
    return (
        <Badge className={styles.statusBadge} color="green" variant="light" radius="sm">
            In Stock
        </Badge>
    );
}

export default function Inventory() {

    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState<SortOption>('insert_date');
    const [activePage, setActivePage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [totalRecords, setTotalRecords] = useState(0);

    const [records, setRecords] = useState<InventoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const totalPages = Math.ceil(totalRecords / pageSize);

    const [debouncedSearch] = useDebouncedValue(searchTerm, 350);
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedMedicine, setSelectedMedicine] = useState<any>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleUpdateRecord = (row: any) => {
        setSelectedMedicine(row); // Save clicked row data
        setModalOpen(true);       // Launch popup
    };

    const handleAddNew = () => {
        setSelectedMedicine(null); // No initial data => modal renders in "add" mode
        setModalOpen(true);
    };
    // Reset page to 1 when filters or page size change
    useEffect(() => {
        setActivePage(1);
    }, [searchTerm, pageSize]);
    const [popoverOpened, { toggle, close }] = useDisclosure(false);
    // Fetch live inventory data whenever filters, sort, or page changes (runs on mount too).
    useEffect(() => {
        let ignore = false;

        async function loadInventory() {
            setLoading(true);
            setError(null);
            try {
                const response = await getInventoryList({
                    search: debouncedSearch.trim() || undefined, // This triggers the backend OR clause across name, manufacturer, and composition
                    sortBy: sortOption,
                    page: activePage,
                    limit: pageSize,
                });

                if (ignore) return;

                const rows = response.data ?? [];
                const total = response.pagination?.total || 0;
                setRecords(rows);
                setTotalRecords(total);
            } catch (err) {
                if (ignore) return;
                setError(
                    err instanceof Error
                        ? err.message
                        : 'Unable to reach the inventory server. Please try again shortly.'
                );
                setRecords([]);
                setTotalRecords(0);
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        loadInventory();
        return () => {
            ignore = true;
        };
    }, [debouncedSearch, sortOption, activePage, pageSize, refreshKey]);

    // The backend only supports server-side sorting for name/manufacturer_name/type/composition columns,
    // so "Newest Stock" and "Expiry Date" are guaranteed client-side to keep the UX correct.
    const sortedRecords = useMemo(() => {
        const rows = [...records];
        switch (sortOption) {
            case 'expiry_date':
                rows.sort((a, b) => {
                    if (!a.expiry_date) return 1;
                    if (!b.expiry_date) return -1;
                    return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
                });
                break;
            case 'manufacturer_name':
                rows.sort((a, b) => (a.manufacturer_name || '').localeCompare(b.manufacturer_name || ''));
                break;
            case 'insert_date':
            default:
                rows.sort((a, b) => new Date(b.insert_date).getTime() - new Date(a.insert_date).getTime());
        }
        return rows;
    }, [records, sortOption]);

    const [deleteRecord, setDeleteRecord] = useState<InventoryRecord | null>(null);

    const handleDeleteRecord = async () => {
        if (!deleteRecord) return;
        try {
            setError(null);
            await deleteInventoryItem({ id: deleteRecord.id, user: 'Sameena', reason: 'Not required' });
            setRecords((prev) => prev.filter((item) => item.id !== deleteRecord.id));
            setTotalRecords((prev) => Math.max(0, prev - 1));
            setDeleteRecord(null); // Close modal on success
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
            setDeleteRecord(null);
        }
    };
    return (
        <Container fluid px={0} py={{ base: 'sm', md: 'md' }}>
            <Stack gap={4} mb={{ base: 'md', md: 'lg' }}>
                <Title order={2} fz={{ base: 'h3', sm: 'h2' }}>
                    Inventory Management
                </Title>
                <Text c="dimmed" size="sm">
                    Browse, search and sort medicines currently available in stock.
                </Text>
            </Stack>

            {/* Filters & Dynamic Popover Sorting Panel.
                Phones: everything stacks into one column and each control is a
                full-width touch target. From `sm` up the same markup collapses
                back into the original single desktop row. */}
            <Paper withBorder radius="md" p={{ base: 'sm', sm: 'md' }} shadow="xs" mb={{ base: 'sm', md: 'md' }}>
                <Flex
                    direction={{ base: 'column', sm: 'row' }}
                    align={{ base: 'stretch', sm: 'flex-end' }}
                    gap={{ base: 'sm', md: 'md' }}
                >
                    <TextInput
                        label="Search"
                        placeholder="Search medicine, manufacturer or composition..."
                        leftSection={<IconSearch size={16} />}
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.currentTarget.value)}
                        w={{ base: '100%', sm: 'auto' }}
                        style={{ flex: 1, minWidth: 0 }}
                    />

                    {/* Action cluster: a 2-column grid means "Order By" and
                        "Add Inventory" share one row at 50% each on phones. */}
                    <SimpleGrid
                        cols={2}
                        spacing="sm"
                        w={{ base: '100%', sm: 'auto' }}
                        style={{ flexShrink: 0 }}
                    >
                        <Popover
                            opened={popoverOpened}
                            onChange={toggle}
                            position="bottom-end"
                            withArrow
                            shadow="md"
                            width="min(320px, calc(100vw - 32px))"
                        >
                            <Popover.Target>
                                {/* A real Button (instead of a bare ActionIcon)
                                    gives the sort control a 44px tap target. */}
                                <Button
                                    variant={popoverOpened ? 'filled' : 'light'}
                                    color="blue"
                                    h={{ base: 44, sm: 36 }}
                                    w="100%"
                                    px={{ base: 'xs', sm: 'md' }}
                                    leftSection={<IconArrowsSort size={16} />}
                                    onClick={toggle}
                                    aria-label="Choose sort order"
                                >
                                    Order By
                                </Button>
                            </Popover.Target>

                            <Popover.Dropdown p="md">
                                <Radio.Group
                                    value={sortOption}
                                    onChange={(value) => {
                                        setSortOption(value as SortOption);
                                        close();
                                    }}
                                >
                                    <Stack gap="xs">
                                        {SORT_OPTIONS.map((option) => (
                                            <Paper
                                                key={option.value}
                                                withBorder
                                                radius="sm"
                                                p="sm"
                                                style={{
                                                    borderColor: sortOption === option.value ? 'var(--mantine-color-blue-5)' : undefined,
                                                    backgroundColor: sortOption === option.value ? 'var(--mantine-color-blue-0)' : undefined,
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => {
                                                    setSortOption(option.value);
                                                    close();
                                                }}
                                            >
                                                <Radio
                                                    value={option.value}
                                                    label={
                                                        <Stack gap={0}>
                                                            <Text size="sm" fw={600}>
                                                                {option.label}
                                                            </Text>
                                                            <Text size="xs" c="dimmed">
                                                                {option.description}
                                                            </Text>
                                                        </Stack>
                                                    }
                                                />
                                            </Paper>
                                        ))}

                                        <Paper withBorder radius="sm" p="sm" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                                            <Group gap="xs" wrap="nowrap">
                                                <IconSparkles size={16} />
                                                <Stack gap={0}>
                                                    <Text size="sm" fw={600}>
                                                        More options
                                                    </Text>
                                                    <Text size="xs" c="dimmed">
                                                        Additional sort properties coming soon
                                                    </Text>
                                                </Stack>
                                            </Group>
                                        </Paper>
                                    </Stack>
                                </Radio.Group>
                            </Popover.Dropdown>
                        </Popover>

                        {/* Add New Inventory */}
                        <Button
                            leftSection={<IconPlus size={16} />}
                            variant="filled"
                            color="blue"
                            h={{ base: 44, sm: 36 }}
                            w="100%"
                            onClick={handleAddNew}
                        >
                            Add Inventory
                        </Button>
                    </SimpleGrid>
                </Flex>
            </Paper>

            <Paper withBorder radius="md" p={{ base: 'sm', sm: 'md' }} shadow="xs">
                <Flex justify="space-between" align="center" gap="sm" wrap="wrap" mb="md">
                    <Group gap="xs" wrap="nowrap">
                        <ThemeIcon variant="light" color="blue" size={32} radius="md">
                            <IconListDetails size={18} />
                        </ThemeIcon>
                        <Title order={4} fz={{ base: 'h5', sm: 'h4' }}>
                            Medicines
                        </Title>
                    </Group>
                    <Badge
                        className={styles.statusBadge}
                        color={loading ? 'gray' : 'blue'}
                        variant="light"
                        radius="sm"
                        size="md"
                    >
                        {loading
                            ? 'Loading…'
                            : `${sortedRecords.length} of ${totalRecords} item${totalRecords === 1 ? '' : 's'}`}
                    </Badge>
                </Flex>

                        {error && (
                            <Alert
                                icon={<IconAlertCircle size={18} />}
                                color="red"
                                variant="light"
                                title="Unable to load inventory"
                                radius="md"
                                mb="md"
                            >
                                {error} Please verify the API server is running at {API_BASE_URL}.
                            </Alert>
                        )}

                        {/*
                            Wide data grid — BOTH axes of overflow stay inside this
                            container, so the document itself never scrolls sideways.
                            `maxHeight` is expressed in dvh so it adapts to mobile
                            browser chrome without needing JS.
                        */}
                        <Table.ScrollContainer
                            minWidth={TABLE_MIN_WIDTH}
                            type="native"
                            styles={{
                                scrollContainer: {
                                    maxHeight: 'min(58dvh, 620px)',
                                    WebkitOverflowScrolling: 'touch',
                                    overscrollBehaviorX: 'contain',
                                },
                            }}
                        >
                            <Table
                                /* Striping and hover tint now live in the CSS module so
                                   the header paint, zebra rows and accent bar are styled
                                   as one system instead of two half-applied layers. */
                                className={styles.grid}
                                verticalSpacing="sm"
                                horizontalSpacing="md"
                                withTableBorder
                                stickyHeader
                                fz={{ base: 'xs', sm: 'sm' }}
                            >
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th w="24%">Medicine Name</Table.Th>
                                        <Table.Th w="16%">Manufacturer</Table.Th>
                                        <Table.Th w="12%">Batch Number</Table.Th>
                                        <Table.Th w="14%">Compound 1</Table.Th>
                                        <Table.Th w="8%" ta="right">Quantity</Table.Th>
                                        <Table.Th w="11%">Expiry Date</Table.Th>
                                        <Table.Th w="8%">Status</Table.Th>
                                        <Table.Th w="7%" ta="center">Actions</Table.Th>
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

                                    {!loading && !error && sortedRecords.length === 0 && (
                                        <Table.Tr>
                                            <Table.Td colSpan={TABLE_COLUMN_COUNT}>
                                                <div className={styles.emptyState}>
                                                    <span className={styles.emptyIcon}>
                                                        <IconInbox size={24} />
                                                    </span>
                                                    <Text fw={600} size="sm">
                                                        No inventory items found
                                                    </Text>
                                                    <Text c="dimmed" size="xs" ta="center">
                                                        Try a different search term, or add a new medicine to get started.
                                                    </Text>
                                                </div>
                                            </Table.Td>
                                        </Table.Tr>
                                    )}

                                    {!loading &&
                                        !error &&
                                        sortedRecords.map((row) => {
                                            const expiryTone = getExpiryTone(row.expiry_date);
                                         
                                            return (
                                                <Table.Tr key={row.id}>
                                                    <Table.Td>
                                                       
                                                            {row.name}
                                                            <br/>
                                                        {row.pack_size_label && (
                                                            <span className={styles.packChip}>{row.pack_size_label}</span>
                                                        )}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        
                                                            {row.manufacturer_name || '—'}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        {row.batch_number ? (
                                                            <span className={styles.codeChip}>{row.batch_number}</span>
                                                        ) : (
                                                            <span className={styles.placeholder}>—</span>
                                                        )}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text
                                                            className={styles.truncate}
                                                            title={row.composition1 || undefined}
                                                            c={row.composition1 ? undefined : 'dimmed'}
                                                            size="sm"
                                                        >
                                                            {row.composition1 || '—'}
                                                        </Text>
                                                    </Table.Td>
                                                    <Table.Td className={styles.numeric}>
                                                       
                                                            {row.stock_quantity}
                                                       
                                                    </Table.Td>
                                                    <Table.Td className={styles.numeric}>
                                                        <span
                                                            className={cn(
                                                                styles.expiry,
                                                                expiryTone === 'soon' && styles.expirySoon,
                                                                expiryTone === 'past' && styles.expiryPast
                                                            )}
                                                        >
                                                            {formatExpiryDate(row.expiry_date)}
                                                        </span>
                                                    </Table.Td>
                                                    <Table.Td>{renderStatusBadge(row)}</Table.Td>
                                                    <Table.Td>
                                                        <Group justify="center" gap="xs" wrap="nowrap">
                                                            {/* `data-touch-target` bumps these
                                                                icon buttons to a 44px hit area on
                                                                touch devices only (see index.css). */}
                                                            <ActionIcon
                                                                data-touch-target
                                                                className={styles.iconButton}
                                                                variant="subtle"
                                                                color="blue"
                                                                radius="md"
                                                                size={32}
                                                                onClick={() => handleUpdateRecord(row)}
                                                                aria-label={`Edit ${row.name}`}
                                                            >
                                                                <IconEdit size={16} />
                                                            </ActionIcon>

                                                            <ActionIcon
                                                                data-touch-target
                                                                className={styles.iconButton}
                                                                variant="subtle"
                                                                color="red"
                                                                radius="md"
                                                                size={32}
                                                                onClick={() => setDeleteRecord(row)}
                                                                aria-label={`Delete ${row.name}`}
                                                            >
                                                                <IconTrash size={16} />
                                                            </ActionIcon>
                                                        </Group>
                                                    </Table.Td>
                                                </Table.Tr>
                                            );
                                        })}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>

                        {/* Panning hint — only meaningful while the grid is
                            actually overflowing, i.e. below the `md` breakpoint. */}
                        <Text size="xs" c="dimmed" ta="center" mt="xs" hiddenFrom="md">
                            Swipe the table sideways to see every column
                        </Text>

                        {/* Pagination bar: stacked and centered on phones, a
                            single spread row from `sm` up. */}
                        <Flex
                            direction={{ base: 'column-reverse', sm: 'row' }}
                            justify={{ base: 'center', sm: 'space-between' }}
                            align="center"
                            gap="sm"
                            mt="md"
                        >
                            <Select
                                value={String(pageSize)}
                                onChange={(value) => setPageSize(Number(value) || 10)}
                                data={['5', '10', '20', '50']}
                                leftSection={<IconListDetails size={16} />}
                                w={{ base: '100%', sm: '6rem' }}
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
                        </Flex>
                    </Paper>

            <Modal
                opened={!!deleteRecord}
                onClose={() => setDeleteRecord(null)}
                title={<Text fw={700} c="red.7">Warning: Permanent Action</Text>}
                centered
                size="sm"
                overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
            >
                <Text size="sm" mb="lg">
                    Are you sure you want to delete <strong>{deleteRecord?.name}</strong>?
                </Text>
                {/* Destructive actions stack full-width on phones so the
                    primary choice cannot be mis-tapped by a thumb. */}
                <Flex direction={{ base: 'column-reverse', sm: 'row' }} justify="flex-end" gap="sm">
                    <Button
                        variant="light"
                        color="gray"
                        size="sm"
                        w={{ base: '100%', sm: 'auto' }}
                        onClick={() => setDeleteRecord(null)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="filled"
                        color="red"
                        size="sm"
                        w={{ base: '100%', sm: 'auto' }}
                        onClick={handleDeleteRecord}
                    >
                        Yes, Delete
                    </Button>
                </Flex>
            </Modal>
            <AddInventory
                opened={modalOpen}
                onClose={() => setModalOpen(false)}
                initialData={selectedMedicine}
                onSuccess={() => {
                    setModalOpen(false);
                    setSelectedMedicine(null);
                    setRefreshKey((key) => key + 1);
                }}
            />
        </Container>
    );
}
