// -----------------------------------------------------------------------------
// RevenueChart — dashboard widget that renders pharma sales revenue trends.
//
// The widget is a thin presentation layer over `useRevenueAnalytics`: it maps
// user interactions (and, indirectly, AI-agent tool calls) into hook state and
// renders the resulting time-series as gradient columns with Recharts.
//
//   * Timeframe segmented control : Daily | Monthly | Weekly | Custom date range
//                                  (Daily is the default view)
//   * Custom date pickers        : two Mantine DatePickerInputs (start / end)
//   * Client validation          : >31 day custom ranges are blocked inline with
//                                  "Date range cannot exceed one month."
//   * States                     : loading skeleton, empty (no sales), error
//
// Chart anatomy (why it looks the way it does):
//   * gradient columns on a soft "track" background -> easy period comparison
//   * the strongest bucket gets a distinct cyan gradient (peak period)
//   * a dashed average reference line + legend -> instant read of above/below avg
//   * the hovered column is brightened (rounded hover band) instead of restyled
// -----------------------------------------------------------------------------

import '@mantine/dates/styles.css';
import { useMemo } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { AlertTriangle, BarChart3, Calendar, RefreshCw, Wallet } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MAX_CUSTOM_RANGE_DAYS, useRevenueAnalytics } from '../hooks/useRevenueAnalytics';
import type { RevenueGranularity, RevenueTimeframe } from '../services/dashboardRevenue';
import styles from './revenueChart.module.css';

// ---------------------------------------------------------------------------
// Formatting / date helpers (kept dependency-free on purpose)
// ---------------------------------------------------------------------------

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

/** Accepts either a monthly bucket label ('2026-09') or a full ISO date. */
const formatBucket = (label: string): string => {
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (month) return `${MONTH_NAMES[Number(month[2]) - 1]} ${month[1]}`;
  const date = parseIso(label);
  // Full ISO dates are day buckets — show the day so the "Best period" tile is precise.
  if (date) return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  return label;
};

const formatAxisTick = (label: string, granularity: RevenueGranularity): string => {
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (month) return MONTH_NAMES[Number(month[2]) - 1];
  const date = parseIso(label);
  if (date) {
    return granularity === 'day' ? `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}` : formatBucket(label);
  }
  return label;
};

const formatAmount = (value: number, currency = 'INR'): string => {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? '';
  return `${symbol}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
};

const compactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${Math.round(value / 1e3)}k`;
  return `${Math.round(value)}`;
};

// ---------------------------------------------------------------------------
// Recharts custom tooltip
// ---------------------------------------------------------------------------

interface ChartDatum {
  bucket: string;
  revenue: number;
  invoices: number;
  rangeLabel: string;
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string | ReadonlyArray<number | string>;
  payload?: ChartDatum;
}

function ChartTip(props: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<TooltipEntry>;
  currency?: string;
}) {
  const { active, payload, label, currency } = props;
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0];
  const datum = entry?.payload ?? null;
  const rawValue = entry?.value;
  const revenue =
    typeof rawValue === 'number'
      ? rawValue
      : Array.isArray(rawValue) && typeof rawValue[0] === 'number'
        ? rawValue[0]
        : datum?.revenue ?? 0;

  return (
    <div className={styles.chartTooltip} role="status">
      <div className={styles.chartTooltipLabel}>{datum ? datum.rangeLabel : String(label ?? '')}</div>
      <div className={styles.chartTooltipRow}>
        <span className={styles.chartTooltipKey}>
          {/* The bar fill is an SVG gradient URL, so the swatch is styled in CSS. */}
          <span className={styles.chartTooltipDot} />
          Revenue
        </span>
        <span className={styles.chartTooltipValue}>{formatAmount(revenue, currency)}</span>
      </div>
      <div className={styles.chartTooltipRow}>
        <span className={styles.chartTooltipKey}>Invoices</span>
        <span className={styles.chartTooltipValue}>{datum?.invoices ?? 0}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static option sets
// ---------------------------------------------------------------------------

const TIMEFRAME_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
];

const DAY_WINDOW_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

const MONTH_WINDOW_OPTIONS = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
];

const WEEK_WINDOW_OPTIONS = [
  { value: '4', label: '4 weeks' },
  { value: '8', label: '8 weeks' },
  { value: '12', label: '12 weeks' },
];

const GRANULARITY_OPTIONS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RevenueChart() {
  const analytics = useRevenueAnalytics();
  const {
    timeframe,
    days,
    months,
    weeks,
    startDate,
    endDate,
    granularity,
    rangeDays,
    data,
    status,
    isLoading,
    error,
    issue,
    setTimeframe,
    setDailyWindow,
    setMonthlyWindow,
    setWeeklyWindow,
    setCustomStartDate,
    setCustomEndDate,
    setGranularity,
    reset,
    refresh,
  } = analytics;

  const currency = data?.currency ?? 'INR';
  const isCustom = timeframe === 'custom';

  const chartData: ChartDatum[] = useMemo(() => {
    if (!data) return [];
    return data.series.map((point) => ({
      bucket: point.label,
      revenue: Math.round(point.total),
      invoices: point.invoiceCount,
      rangeLabel:
        point.startDate === point.endDate
          ? formatDay(point.startDate)
          : `${formatDay(point.startDate)} – ${formatDay(point.endDate)}`,
    }));
  }, [data]);

  /**
   * Mean revenue across the visible buckets — drives the dashed reference line
   * and the "Average" legend entry. `null` when there is nothing to average.
   */
  const averageRevenue = useMemo(() => {
    if (chartData.length === 0) return null;
    const total = chartData.reduce((sum, point) => sum + point.revenue, 0);
    return Math.round(total / chartData.length);
  }, [chartData]);

  /** Bucket label of the strongest period; rendered with the peak gradient. */
  const peakBucket = data?.summary.bestPeriod?.label ?? null;

  const blocked = isCustom && issue !== null;
  const showSkeleton = isLoading && !blocked;
  const isReady = status === 'ready' && data !== null;
  const hasSales = isReady && data.summary.totalRevenue > 0;

  const subtitle = useMemo(() => {
    if (!data) return null;
    const { range } = data;
    if (data.timeframe === 'daily') {
      return `Last ${days} day${days === 1 ? '' : 's'} · ${formatDay(range.startDate)} – ${formatDay(range.endDate)}`;
    }
    if (data.timeframe === 'monthly') {
      return `Last ${months} month${months === 1 ? '' : 's'} · ${formatDay(range.startDate)} – ${formatDay(range.endDate)}`;
    }
    if (data.timeframe === 'weekly') {
      return `Last ${weeks} week${weeks === 1 ? '' : 's'} · ${formatDay(range.startDate)} – ${formatDay(range.endDate)}`;
    }
    return `${formatDay(range.startDate)} – ${formatDay(range.endDate)}`;
  }, [data, days, months, weeks]);

  const emptyMessage = ((): string => {
    if (isCustom) {
      return startDate && endDate
        ? `No sales were recorded between ${formatDay(startDate)} and ${formatDay(endDate)}.`
        : 'Select a date range to chart revenue.';
    }
    const windowLabel =
      timeframe === 'daily'
        ? `${days} day${days === 1 ? '' : 's'}`
        : timeframe === 'monthly'
          ? `${months} month${months === 1 ? '' : 's'}`
          : `${weeks} week${weeks === 1 ? '' : 's'}`;
    return `No sales were recorded in the last ${windowLabel}.`;
  })();

  const handleTimeframeChange = (value: string): void => {
    setTimeframe(value as RevenueTimeframe);
  };

  const renderChart = () => (
    <div className={styles.chartCanvasWrap}>
      <div className={styles.chartCanvas}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 14, left: 0, bottom: 0 }}
            barCategoryGap="24%"
            accessibilityLayer
          >
            <defs>
              {/* Standard column: teal gradient that deepens toward the baseline. */}
              <linearGradient id="revenueBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--mantine-color-teal-4)" />
                <stop offset="55%" stopColor="var(--mantine-color-teal-6)" />
                <stop offset="100%" stopColor="var(--mantine-color-teal-8)" stopOpacity={0.85} />
              </linearGradient>
              {/* Peak period: cooler cyan-teal so the best bucket reads instantly. */}
              <linearGradient id="revenueBarPeakFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--mantine-color-cyan-4)" />
                <stop offset="60%" stopColor="var(--mantine-color-teal-5)" />
                <stop offset="100%" stopColor="var(--mantine-color-teal-7)" />
              </linearGradient>
              {/* Hovered column: brightened, matching the rounded hover band. */}
              <linearGradient id="revenueBarActiveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--mantine-color-teal-1)" />
                <stop offset="100%" stopColor="var(--mantine-color-teal-4)" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--mantine-color-gray-2)" />
            <XAxis
              dataKey="bucket"
              height={34}
              tickLine={false}
              axisLine={{ stroke: 'var(--mantine-color-gray-3)' }}
              tick={{ fontSize: 11.5, fill: 'var(--mantine-color-gray-6)' }}
              tickFormatter={(value: string) => formatAxisTick(value, data?.granularity ?? 'day')}
              minTickGap={18}
              interval="preserveStartEnd"
            />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11.5, fill: 'var(--mantine-color-gray-6)' }}
              tickFormatter={(value: number) => compactNumber(value)}
              allowDecimals={false}
            />
            <ChartTooltip
              cursor={{
                className: styles.barCursor,
                fill: 'var(--mantine-color-teal-0)',
                fillOpacity: 0.9,
              }}
              content={(tooltipProps) => <ChartTip {...tooltipProps} currency={currency} />}
            />
            {averageRevenue !== null && averageRevenue > 0 && (
              <ReferenceLine
                y={averageRevenue}
                stroke="var(--mantine-color-gray-5)"
                strokeDasharray="5 5"
                strokeWidth={1.25}
                label={{
                  value: `avg ${compactNumber(averageRevenue)}`,
                  position: 'insideTopRight',
                  fill: 'var(--mantine-color-gray-6)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
            )}
            <Bar
              dataKey="revenue"
              name="Revenue"
              radius={[10, 10, 3, 3]}
              maxBarSize={54}
              minPointSize={(value: number | null | undefined) =>
                typeof value === 'number' && value > 0 ? 3 : 0
              }
              background={{
                fill: 'var(--mantine-color-gray-1)',
                fillOpacity: 0.6,
                // Uniform radius here: Recharts types `background`/`activeBar`
                // radii against SVGProps, so a 4-tuple is not assignable.
                radius: 10,
              }}
              activeBar={{
                fill: 'url(#revenueBarActiveFill)',
                stroke: 'var(--mantine-color-teal-6)',
                strokeWidth: 1.5,
                radius: 10,
              }}
              animationDuration={700}
              animationEasing="ease-out"
            >
              {chartData.map((datum) => (
                <Cell
                  key={datum.bucket}
                  fill={
                    datum.bucket === peakBucket
                      ? 'url(#revenueBarPeakFill)'
                      : 'url(#revenueBarFill)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartLegend}>
        <span className={styles.chartLegendItem}>
          <span className={styles.legendSwatchBar} />
          Revenue per {data?.granularity ?? 'period'}
        </span>
        {peakBucket && (
          <span className={styles.chartLegendItem}>
            <span className={styles.legendSwatchPeak} />
            Peak period
          </span>
        )}
        {averageRevenue !== null && averageRevenue > 0 && (
          <span className={styles.chartLegendItem}>
            <span className={styles.legendSwatchAvg} />
            Average
          </span>
        )}
      </div>
    </div>
  );

  const renderSkeleton = () => (
    <div className={styles.skeletonStage} aria-busy="true" aria-label="Loading revenue data">
      <Group align="stretch" gap="sm" h="100%">
        <div className={styles.skeletonAxis}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeletonAxisLine} style={{ height: 10, background: 'var(--mantine-color-gray-2)', borderRadius: 4 }} />
          ))}
        </div>
        <div className={styles.skeletonPlot}>
          {[46, 78, 58, 92, 66, 84, 52, 96, 70, 60, 88, 74].map((h, i) => (
            <div key={i} className={styles.skeletonBar} style={{ height: `${h}%` }} />
          ))}
        </div>
      </Group>
    </div>
  );

  const renderEmpty = (icon: React.ReactNode, title: string, hint: string) => (
    <div className={styles.statePanel}>
      <ThemeIcon variant="light" color="gray" size="xl" radius="xl">
        {icon}
      </ThemeIcon>
      <div className={styles.statePanelTitle}>{title}</div>
      <div className={styles.statePanelHint}>{hint}</div>
    </div>
  );

  const summary = data?.summary;

  return (
    <Paper p="lg" radius="md" shadow="sm" withBorder className={styles.card}>
      {/* ---------- Header: title + timeframe switcher + refresh ---------- */}
      <div className={styles.headerRow}>
        <Group gap="sm" align="center">
          <ThemeIcon variant="light" color="teal" size="lg" radius="md">
            <Wallet size={18} />
          </ThemeIcon>
          <div className={styles.titleBlock}>
            <Title order={3} fw={700} c="gray.9" lh="sm">
              Revenue Analytics
            </Title>
            <Text size="xs" c="gray.6">
              Sales trend from billing invoices
            </Text>
          </div>
        </Group>

        <Group gap="sm" wrap="nowrap" align="center">
          <SegmentedControl
            data={TIMEFRAME_OPTIONS}
            value={timeframe}
            onChange={handleTimeframeChange}
            size="xs"
            color="teal"
          />
          <ActionIcon
            variant="light"
            color="gray"
            aria-label="Refresh revenue data"
            onClick={refresh}
            loading={status === 'loading'}
          >
            <RefreshCw size={16} />
          </ActionIcon>
        </Group>
      </div>

      {/* ---------- Controls: window size / custom date range ---------- */}
      {!isCustom && (
        <Group gap="sm" align="center" wrap="wrap">
          <Text size="sm" fw={600} c="gray.7">
            Show last
          </Text>
          {timeframe === 'daily' ? (
            <SegmentedControl
              data={DAY_WINDOW_OPTIONS}
              value={String(days)}
              onChange={(value) => setDailyWindow(Number(value))}
              size="xs"
            />
          ) : timeframe === 'monthly' ? (
            <SegmentedControl
              data={MONTH_WINDOW_OPTIONS}
              value={String(months)}
              onChange={(value) => setMonthlyWindow(Number(value))}
              size="xs"
            />
          ) : (
            <SegmentedControl
              data={WEEK_WINDOW_OPTIONS}
              value={String(weeks)}
              onChange={(value) => setWeeklyWindow(Number(value))}
              size="xs"
            />
          )}
        </Group>
      )}

      {isCustom && (
        <Stack gap="xs">
          <Group align="flex-end" gap="md" wrap="wrap">
            <DatePickerInput
              className={styles.dateField}
              label="Start date"
              placeholder="Pick start date"
              value={startDate || null}
              onChange={(value: string | null) => setCustomStartDate(value ?? '')}
              valueFormat="DD MMM YYYY"
              maxDate={todayIso()}
              clearable
              size="sm"
            />
            <Text c="gray.5" pb="sm">
              to
            </Text>
            <DatePickerInput
              className={styles.dateField}
              label="End date"
              placeholder="Pick end date"
              value={endDate || null}
              onChange={(value: string | null) => setCustomEndDate(value ?? '')}
              valueFormat="DD MMM YYYY"
              minDate={startDate || undefined}
              maxDate={todayIso()}
              clearable
              size="sm"
            />
            <div className={styles.granularityField}>
              <Text size="xs" fw={600} c="gray.6" mb={4}>
                Bucket size
              </Text>
              <SegmentedControl
                data={GRANULARITY_OPTIONS}
                value={granularity}
                onChange={(value) => setGranularity(value as RevenueGranularity)}
                size="xs"
              />
            </div>
          </Group>

          {/* Inline validation feedback for the custom range */}
          {issue && issue.kind !== 'missing' && (
            <Alert
              icon={<AlertTriangle size={16} />}
              color="red"
              variant="light"
              radius="md"
              title="Invalid date range"
            >
              {issue.message}
            </Alert>
          )}

          {!issue && startDate && endDate && rangeDays !== null && (
            <Text size="xs" c="dimmed">
              Selected range spans {rangeDays} day{rangeDays === 1 ? '' : 's'} (max {MAX_CUSTOM_RANGE_DAYS} days).
            </Text>
          )}
        </Stack>
      )}

      {/* ---------- Range caption + summary KPIs (ready data) ---------- */}
      {isReady && hasSales && (
        <>
          <div className={styles.rangeCaption}>
            <Badge size="sm" variant="light" color={isCustom ? 'blue' : 'teal'} leftSection={<Calendar size={11} />}>
              {data?.granularity} buckets
            </Badge>
            <Text size="xs" c="gray.6">
              {subtitle}
            </Text>
          </div>

          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" verticalSpacing="sm">
            <div className={styles.statTile}>
              <div className={styles.statTileLabel}>Total Revenue</div>
              <div className={styles.statTileValue}>{summary ? formatAmount(summary.totalRevenue, currency) : '—'}</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statTileLabel}>Invoices</div>
              <div className={styles.statTileValue}>{summary ? summary.totalInvoices.toLocaleString('en-IN') : '—'}</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statTileLabel}>Avg / {data?.granularity}</div>
              <div className={styles.statTileValue}>{summary ? formatAmount(summary.averagePerPeriod, currency) : '—'}</div>
            </div>
            <div className={`${styles.statTile} ${styles.statTileAccent}`}>
              <div className={styles.statTileLabel}>Best period</div>
              <div className={styles.statTileValue} style={{ fontSize: 14 }}>
                {summary?.bestPeriod
                  ? `${formatBucket(summary.bestPeriod.label)} · ${formatAmount(summary.bestPeriod.total, currency)}`
                  : '—'}
              </div>
            </div>
          </SimpleGrid>
        </>
      )}

      {/* ---------- Chart stage: blocked / error / loading / empty / chart ---------- */}
      <div className={styles.chartStage}>
        {blocked ? (
          renderEmpty(
            <Calendar size={22} />,
            'Adjust the selected range',
            'Pick a valid start and end date to chart revenue for that period.'
          )
        ) : status === 'error' ? (
          <Box>
            <Alert
              icon={<AlertTriangle size={16} />}
              color="red"
              variant="light"
              radius="md"
              title="Could not load revenue data"
              mb="md"
            >
              {error || 'Something went wrong while loading the revenue chart.'}
            </Alert>
            <Group gap="sm">
              <ActionIcon variant="filled" color="teal" onClick={refresh} aria-label="Retry">
                <RefreshCw size={16} />
              </ActionIcon>
              <ActionIcon variant="light" color="gray" onClick={reset} aria-label="Reset to daily view">
                Reset view
              </ActionIcon>
            </Group>
          </Box>
        ) : showSkeleton ? (
          renderSkeleton()
        ) : hasSales ? (
          renderChart()
        ) : (
          renderEmpty(
            <BarChart3 size={22} />,
            'No sales in this period',
            emptyMessage
          )
        )}
      </div>
    </Paper>
  );
}
