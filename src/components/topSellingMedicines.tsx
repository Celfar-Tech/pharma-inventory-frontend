
import '@mantine/dates/styles.css';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import {
  AlertTriangle,
  Calendar,
  ChartColumn,
  Info,
  Pill,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trophy,
  Wrench,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTopSellingMedicines } from '../hooks/useTopSellingMedicines';
import type {
  TopSellingData,
  TopSellingMedicine,
  TopSellingSortBy,
} from '../services/topSellingMedicines';
import styles from './topSellingMedicines.module.css';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** Today as a local YYYY-MM-DD string. */
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const parseIso = (iso: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

/** '2026-09-07' -> '7 Sep 2026'. */
const formatDay = (iso: string): string => {
  const date = parseIso(iso);
  if (!date) return iso;
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
};

const formatAmount = (value: number, currency = 'INR'): string => {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? '';
  return `${symbol}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
};


const formatUnits = (value: number): string => value.toLocaleString('en-IN');

/** How the leaderboard is ranked — the metric the server orders the page by. */
const SORT_OPTIONS = [
  { value: 'quantity', label: 'Most sold' },
  { value: 'revenue', label: 'Highest revenue' },
];

/** Noun used in tooltips/footnotes for whichever metric is active. */
const METRIC_NOUN: Record<TopSellingSortBy, string> = {
  quantity: 'units sold',
  revenue: 'revenue',
};

/**
 * Podium styling for the three best-selling medicines. The rank always matches the active
 * metric (the server ranks the page), so a medal can never end up in the wrong place.
 */
const PODIUM_CLASSES = [styles.rankGold, styles.rankSilver, styles.rankBronze];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TopSellingMedicines() {
  const {
    days,
    pageSize,
    pageSizeOptions,
    sortBy,
    sortOptions,
    startDate,
    endDate,
    isCustom,
    rangeIssue,
    data,
    status,
    isLoading,
    error,
    hint,
    errorStatus,
    needsRollup,
    isRefreshingRollup,
    setRange,
    clearRange,
    setSortBy,
    setPageSize,
    refresh,
    refreshRollup,
  } = useTopSellingMedicines();

  const metricNoun = METRIC_NOUN[sortBy];

  /** Dropdown entries for the "records to show" control. */
  const pageSizeData = useMemo(
    () => pageSizeOptions.map((size) => ({ value: String(size), label: String(size) })),
    [pageSizeOptions]
  );

  /** Metrics the API accepts, in the app's preferred order. */
  const sortData = useMemo(
    () => SORT_OPTIONS.filter((option) => sortOptions.includes(option.value as TopSellingSortBy)),
    [sortOptions]
  );

  /** The range picker shows the custom dates, or nothing while the default window is active. */
  const rangeValue: [string | null, string | null] = [startDate || null, endDate || null];

  const handleRebuildRollup = async (force: boolean): Promise<void> => {
    try {
      const result = await refreshRollup(force ? { force: true } : {});

      if (result.refreshed) {
        notifications.show({
          title: needsRollup ? 'Sales rollup provisioned' : 'Sales rollup rebuilt',
          message: `Figures refreshed${
            typeof result.durationMs === 'number' ? ` in ${result.durationMs} ms` : ''
          }. The dashboard has been reloaded with the new snapshot.`,
          color: 'blue',
          icon: <Sparkles size={18} />,
        });
        return;
      }

      const wait = result.nextAllowedInSeconds;
      notifications.show({
        title: 'Rollup is already fresh',
        message:
          typeof wait === 'number' && wait > 0
            ? `A rebuild ran recently. Try again in about ${Math.max(1, Math.ceil(wait / 60))} minute(s), or force a rebuild.`
            : result.reason || 'Nothing needed rebuilding.',
        color: 'yellow',
        icon: <Info size={18} />,
      });
    } catch (err) {
      notifications.show({
        title: 'Could not rebuild the rollup',
        message: err instanceof Error ? err.message : 'Please try again in a moment.',
        color: 'red',
        icon: <AlertTriangle size={18} />,
      });
    }
  };

  const isStale = data?.dataThrough != null && data.dataThrough < todayIso();

  /**
   * Any 5xx from a rollup-backed endpoint is worth offering the rebuild for: the
   * documented cause is a missing/unusable `pharma.mv_daily_medicine_sales`, and
   * the rebuild is idempotent (and debounced server-side). A 503 says that
   * outright, so it is forced; other 5xx leave the debounce in place.
   */
  const canRebuild = needsRollup || (errorStatus !== null && errorStatus >= 500);

  // ---- state renderers ------------------------------------------------------

  const renderSkeleton = () => (
    <div className={styles.skeletonWrap} aria-busy="true" aria-label="Loading top-selling medicines">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonPill} />
          <div className={styles.skeletonBar} />
        </div>
      ))}
    </div>
  );

  const renderEmptyPanel = (title: string, message: string) => (
    <div className={styles.statePanel}>
      <ThemeIcon variant="light" color="gray" size="xl" radius="xl">
        <ChartColumn size={22} />
      </ThemeIcon>
      <div className={styles.statePanelTitle}>{title}</div>
      <div className={styles.statePanelHint}>{message}</div>
    </div>
  );

  const renderError = () => (
    <Box>
      <Alert
        icon={needsRollup ? <Wrench size={16} /> : <AlertTriangle size={16} />}
        color={needsRollup ? 'yellow' : 'red'}
        variant="light"
        radius="md"
        title={needsRollup ? 'Sales rollup not provisioned yet' : 'Could not load top sellers'}
      >
        <Stack gap={6}>
          <Text size="sm">
            {error ||
              (needsRollup
                ? 'The materialized view behind this report has not been created for this database.'
                : 'Something went wrong while loading the top-selling medicines.')}
          </Text>
          {needsRollup && hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
          {!needsRollup && canRebuild && (
            <Text size="xs" c="dimmed">
              This report reads the pharma.mv_daily_medicine_sales rollup. If that view is missing
              or unusable, rebuilding it clears the failure.
            </Text>
          )}
        </Stack>
      </Alert>

      <Group gap="sm" mt="md">
        {canRebuild && (
          <Button
            size="sm"
            color="blue"
            leftSection={<Wrench size={15} />}
            loading={isRefreshingRollup}
            onClick={() => void handleRebuildRollup(needsRollup)}
            h={{ base: 44, sm: 36 }}
          >
            {needsRollup ? 'Rebuild rollup now' : 'Rebuild sales rollup'}
          </Button>
        )}
        <Button
          size="sm"
          variant="light"
          color="gray"
          leftSection={<RefreshCw size={15} />}
          onClick={refresh}
          h={{ base: 44, sm: 36 }}
        >
          Retry
        </Button>
      </Group>
    </Box>
  );

  // ---- content (only rendered once the first payload has landed) ------------

  const renderContent = (payload: TopSellingData) => {
    const rows = payload.series;
    /** The metric the list is ranked by — drives bar length and the emphasised value. */
    const metricValue = (row: TopSellingMedicine): number =>
      sortBy === 'revenue' ? row.totalRevenue : row.totalQuantitySold;
    const maxMetric = rows.reduce((max, row) => Math.max(max, metricValue(row)), 0);
    const totalUnits = rows.reduce((sum, row) => sum + row.totalQuantitySold, 0);
    const totalRevenue = rows.reduce((sum, row) => sum + row.totalRevenue, 0);

    return (
      <Stack gap="xs">
        <div className={styles.listHeader}>
          <Group gap={6} align="baseline" wrap="wrap">
            <Text fw={700} size="sm" c="gray.8">
              Top sellers
            </Text>
            <Text size="xs" c="gray.6">
              {`${rows.length} medicine${rows.length === 1 ? '' : 's'} · ${formatUnits(totalUnits)} units · ${formatAmount(totalRevenue, payload.currency)}`}
            </Text>
          </Group>

          <Group gap={6} align="center" wrap="nowrap">
            <Tooltip
              multiline
              w={230}
              withArrow
              label="How many medicines the leaderboard shows. The server returns this page ranked by the selected metric."
            >
              <Text size="xs" c="gray.6" style={{ cursor: 'help' }}>
                Show
              </Text>
            </Tooltip>
            <Select
              data={pageSizeData}
              value={String(pageSize)}
              onChange={(value) => {
                if (value) setPageSize(Number(value));
              }}
              size="xs"
              w={74}
              allowDeselect={false}
              comboboxProps={{ shadow: 'md' }}
              aria-label="Number of top-selling medicines to show"
            />
          </Group>
        </div>

        <div className={styles.list}>
          {rows.map((row, index) => {
            const podiumClass = PODIUM_CLASSES[row.rank - 1] ?? '';
            const share = maxMetric > 0 ? Math.round((metricValue(row) / maxMetric) * 100) : 0;

            return (
              <article
                key={`${row.medicineId ?? 'legacy'}-${row.medicineName}`}
                className={styles.row}
                // Only the rows a bigger page size reveals run the entrance animation — a short
                // cascade, capped so the last of 100 rows still lands well under a second.
                style={{ animationDelay: `${Math.min(index, 14) * 16}ms` }}
              >
                <span
                  className={`${styles.rank} ${podiumClass}`}
                  title={`Ranked #${row.rank} by ${metricNoun} in this range`}
                >
                  {row.rank === 1 ? <Trophy size={13} /> : row.rank}
                </span>

                <div className={styles.rowBody}>
                  <span className={styles.rowName} title={row.medicineName}>
                    {row.medicineName}
                  </span>
                  <div
                    className={styles.barTrack}
                    title={`${share}% of the top medicine by ${metricNoun}`}
                  >
                    <div className={styles.bar} style={{ width: `${Math.max(6, share)}%` }} />
                  </div>
                </div>

                <div className={styles.rowValues} data-sort={sortBy}>
                  <span className={styles.rowUnits}>
                    {formatUnits(row.totalQuantitySold)}
                    <span className={styles.rowUnitsLabel}>units</span>
                  </span>
                  <span className={styles.rowRevenue}>
                    {formatAmount(row.totalRevenue, payload.currency)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        <Text size="xs" c="dimmed" className={styles.listFootnote}>
          Bar length compares each medicine with the top seller by {metricNoun} in the selected
          range.
        </Text>
      </Stack>
    );
  };

  const hasSales = data !== null && data.series.length > 0;

  return (
    <Paper p="lg" radius="md" shadow="sm" withBorder className={styles.card}>
      {/* ---------- Header: title + freshness + actions ---------- */}
      <div className={styles.headerRow}>
        <Group gap="sm" align="center">
          <ThemeIcon variant="light" color="blue" size="lg" radius="md">
            <Pill size={18} />
          </ThemeIcon>
          <div className={styles.titleBlock}>
            <Title order={3} fw={700} c="gray.9" lh="sm">
              Top-Selling Medicines
            </Title>
            <Text size="xs" c="gray.6">
              Best-selling medicines in the selected date range
            </Text>
          </div>
        </Group>

        <Group gap="xs" wrap="nowrap" align="center">
          {data?.dataThrough && (
            <Tooltip
              multiline
              w={250}
              withArrow
              label={
                isStale
                  ? 'Sales after this date are not in the rollup yet — rebuild it to catch up.'
                  : 'The sales rollup is caught up with the billing entries.'
              }
            >
              <Badge
                size="sm"
                variant="light"
                color={isStale ? 'yellow' : 'blue'}
                leftSection={<Calendar size={11} />}
                style={{ cursor: 'help' }}
              >
                as of {formatDay(data.dataThrough)}
              </Badge>
            </Tooltip>
          )}

          <Tooltip label="Reload top sellers" withArrow>
            <ActionIcon
              variant="light"
              color="gray"
              aria-label="Reload top sellers"
              onClick={refresh}
              loading={isLoading}
            >
              <RefreshCw size={16} />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            multiline
            w={230}
            withArrow
            label="Rebuild the sales rollup from the billing tables (at most once every 5 minutes)."
          >
            <ActionIcon
              variant="light"
              color="blue"
              aria-label="Rebuild the sales rollup"
              loading={isRefreshingRollup}
              onClick={() => void handleRebuildRollup(false)}
            >
              <Wrench size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      {/* ---------- Toolbar: the date range and the ranking metric ---------- */}
      <div className={styles.toolbar}>
        <div className={styles.control}>
          <Text className={styles.controlLabel}>Date range</Text>
          <Group gap={6} align="center" wrap="nowrap">
            <DatePickerInput
              type="range"
              value={rangeValue}
              onChange={setRange}
              valueFormat="DD MMM YYYY"
              placeholder={`Last ${days} days`}
              maxDate={todayIso()}
              allowSingleDateInRange
              clearable
              size="xs"
              w={232}
              aria-label="Sales date range"
            />
            {isCustom && (
              <Tooltip label={`Back to the last ${days} days`} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Clear the custom date range"
                  onClick={clearRange}
                >
                  <RotateCcw size={15} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </div>

        <div className={styles.control}>
          <Text className={styles.controlLabel}>Sort by</Text>
          <SegmentedControl
            data={sortData}
            value={sortBy}
            onChange={(value) => setSortBy(value as TopSellingSortBy)}
            size="xs"
            color="blue"
          />
        </div>
      </div>

      {/* One line that spells out which window and which order the numbers below use, so a
          customer never has to guess what a rank pill means. */}
      {data && rangeIssue === null && (
        <Text size="xs" c="gray.6" className={styles.rangeNote}>
          {formatDay(data.range.startDate)} – {formatDay(data.range.endDate)}
          {` · medicines ranked by ${metricNoun}`}
        </Text>
      )}

      {/* ---------- Body: range issue / error / loading / empty / content ---------- */}
      {rangeIssue !== null ? (
        <Box>
          <Alert
            icon={<AlertTriangle size={16} />}
            color={rangeIssue.kind === 'incomplete' ? 'blue' : 'red'}
            variant="light"
            radius="md"
            title={rangeIssue.kind === 'incomplete' ? 'Select a date range' : 'Invalid date range'}
          >
            {rangeIssue.message}
          </Alert>
        </Box>
      ) : status === 'error' ? (
        renderError()
      ) : isLoading || status === 'idle' ? (
        renderSkeleton()
      ) : data === null || !hasSales ? (
        renderEmptyPanel(
          'No sales in this period',
          data
            ? `No sales were recorded between ${formatDay(data.range.startDate)} and ${formatDay(data.range.endDate)}. Pick a different date range or check back after the next rollup refresh.`
            : 'Pick a date range to see which medicines sold best.'
        )
      ) : (
        renderContent(data)
      )}
    </Paper>
  );
}
