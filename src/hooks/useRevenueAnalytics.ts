// -----------------------------------------------------------------------------
// useRevenueAnalytics — data hook behind the dashboard revenue chart.
//
// Owns the full "which data am I showing?" state for the revenue widget:
//   * timeframe        (monthly | weekly | custom)
//   * window size      (months / weeks)
//   * custom range     (startDate / endDate / granularity)
//   * fetch lifecycle  (idle | loading | ready | error) + last error message
//
// Client-side validation (mirrors the backend rules in dashboard.js):
//   * A custom date range is limited to 31 inclusive calendar days. Longer
//     selections are BLOCKED client-side with `MAX_RANGE_ERROR_MESSAGE` and the
//     request is never sent.
//   * A reversed (start > end) or future-dated range is also blocked locally.
//   * Backend 400s (e.g. server-side span checks) surface through `error`.
//
// -----------------------------------------------------------------------------
// AI-Agent integration
// --------------------
// The returned imperative API maps 1:1 onto the backend AI-agent tool manifest
// (see pharma-inventory-backend/controllers/dashboard.js -> `agentTools`). An
// in-app agent that receives a tool call can drive this chart directly:
//
//   getMonthlySales({ months: 3 })            -> setMonthlyWindow(3)     (timeframe already 'monthly')
//   getWeeklySales({ weeks: 4 })              -> setWeeklyWindow(4)      (timeframe already 'weekly')
//   getCustomRangeSales({ startDate, endDate, granularity })
//                                            -> setCustomRange({ startDate, endDate, granularity })
//
// Because every imperative call flows through the same React state, the chart,
// KPI summary and pickers always reflect whatever the agent asked for.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import {
  fetchCustomRangeRevenue,
  fetchMonthlyRevenue,
  fetchWeeklyRevenue,
} from '../services/dashboardRevenue';
import type {
  RevenueData,
  RevenueGranularity,
  RevenueTimeframe,
} from '../services/dashboardRevenue';

// Strict business rule shared with the UI: a custom range may not exceed one month.
export const MAX_CUSTOM_RANGE_DAYS = 31;
export const MAX_RANGE_ERROR_MESSAGE = 'Date range cannot exceed one month.';

export type RevenueStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RevenueClientIssue {
  kind: 'missing' | 'reversed' | 'tooLong' | 'future';
  message: string;
}

export interface RevenueConfig {
  timeframe: RevenueTimeframe;
  months: number;
  weeks: number;
  /** Inclusive range start in YYYY-MM-DD; '' means unset. */
  startDate: string;
  /** Inclusive range end in YYYY-MM-DD; '' means unset. */
  endDate: string;
  granularity: RevenueGranularity;
}

const DEFAULT_CONFIG: RevenueConfig = {
  timeframe: 'monthly',
  months: 6,
  weeks: 12,
  startDate: '',
  endDate: '',
  granularity: 'day',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const pad = (value: number): string => String(value).padStart(2, '0');

/** Today as a local YYYY-MM-DD string. */
export const localTodayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Inclusive day count between two YYYY-MM-DD dates (uses UTC math, no DST issues). */
export const daysInRange = (startDate: string, endDate: string): number => {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / MS_PER_DAY) + 1;
};

/** Client-side gate used before any custom-range request is fired. */
export const evaluateClientIssue = (config: RevenueConfig): RevenueClientIssue | null => {
  if (config.timeframe !== 'custom') return null;

  const { startDate, endDate } = config;
  if (!startDate || !endDate) {
    return { kind: 'missing', message: 'Select both a start and an end date to see revenue.' };
  }
  if (startDate > endDate) {
    return { kind: 'reversed', message: 'Start date must be on or before the end date.' };
  }
  if (daysInRange(startDate, endDate) > MAX_CUSTOM_RANGE_DAYS) {
    return { kind: 'tooLong', message: MAX_RANGE_ERROR_MESSAGE };
  }
  if (endDate > localTodayIso()) {
    return { kind: 'future', message: 'End date cannot be in the future.' };
  }
  return null;
};

export interface RevenueAnalytics {
  // ---- current selection (source of truth for the UI + agent) -------------
  timeframe: RevenueTimeframe;
  months: number;
  weeks: number;
  startDate: string;
  endDate: string;
  granularity: RevenueGranularity;
  rangeDays: number | null;

  // ---- fetch lifecycle ------------------------------------------------------
  data: RevenueData | null;
  status: RevenueStatus;
  isLoading: boolean;
  error: string | null;
  /** Client-side validation result for the current selection (custom range only). */
  issue: RevenueClientIssue | null;
  /** True when the current selection is valid enough to send a request. */
  canRequest: boolean;

  // ---- imperative controls (UI + AI agent entry points) --------------------
  setTimeframe: (timeframe: RevenueTimeframe) => void;
  setMonthlyWindow: (months: number) => void;
  setWeeklyWindow: (weeks: number) => void;
  setCustomRange: (range: { startDate: string; endDate: string; granularity?: RevenueGranularity }) => void;
  setCustomStartDate: (date: string) => void;
  setCustomEndDate: (date: string) => void;
  setGranularity: (granularity: RevenueGranularity) => void;
  /** Clear the whole widget back to its default monthly view. */
  reset: () => void;
  /** Re-run the request for the current selection (used by retry buttons). */
  refresh: () => void;
}

export const useRevenueAnalytics = (): RevenueAnalytics => {
  const [config, setConfig] = useState<RevenueConfig>(DEFAULT_CONFIG);
  const [data, setData] = useState<RevenueData | null>(null);
  const [status, setStatus] = useState<RevenueStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  // ---------------------------------------------------------------------------
  // Imperative API. All setters funnel through the same state transitions, so a
  // programmatic call (from the AI agent) behaves exactly like a user interaction.
  // ---------------------------------------------------------------------------
  const setTimeframe = (timeframe: RevenueTimeframe): void => {
    setConfig((current) => ({ ...current, timeframe }));
  };

  const setMonthlyWindow = (months: number): void => {
    setConfig((current) => ({
      ...current,
      timeframe: 'monthly',
      months: clamp(months, 1, 60),
    }));
  };

  const setWeeklyWindow = (weeks: number): void => {
    setConfig((current) => ({
      ...current,
      timeframe: 'weekly',
      weeks: clamp(weeks, 1, 104),
    }));
  };

  const setCustomRange = (range: {
    startDate: string;
    endDate: string;
    granularity?: RevenueGranularity;
  }): void => {
    setConfig((current) => ({
      ...current,
      timeframe: 'custom',
      startDate: range.startDate,
      endDate: range.endDate,
      granularity: range.granularity ?? current.granularity,
    }));
  };

  const setCustomStartDate = (date: string): void => {
    setConfig((current) => ({ ...current, startDate: date }));
  };

  const setCustomEndDate = (date: string): void => {
    setConfig((current) => ({ ...current, endDate: date }));
  };

  const setGranularity = (granularity: RevenueGranularity): void => {
    setConfig((current) => ({ ...current, granularity }));
  };

  const reset = (): void => {
    setConfig(DEFAULT_CONFIG);
    setData(null);
    setError(null);
    setStatus('idle');
  };

  const refresh = (): void => setRefreshCount((count) => count + 1);

  // ---------------------------------------------------------------------------
  // Derived client-side validation (memoized for the render path; the fetch effect
  // below recomputes it so both paths can never drift apart).
  // ---------------------------------------------------------------------------
  const issue = useMemo(() => evaluateClientIssue(config), [config]);
  const canRequest = useMemo(
    () => (config.timeframe === 'custom' ? issue === null : true),
    [config.timeframe, issue]
  );

  const rangeDays =
    config.timeframe === 'custom' && config.startDate && config.endDate && config.startDate <= config.endDate
      ? daysInRange(config.startDate, config.endDate)
      : null;

  // ---------------------------------------------------------------------------
  // Fetch effect — fires once per selection change (or explicit refresh). A stale
  // request is aborted when a newer selection supersedes it or the hook unmounts.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const run = async (): Promise<void> => {
      // Blocked / incomplete selections never hit the network.
      if (config.timeframe === 'custom' && evaluateClientIssue(config) !== null) {
        if (active) {
          setData(null);
          setError(null);
          setStatus('idle');
        }
        return;
      }

      if (active) {
        setStatus('loading');
        setError(null); 
      }

      try {
        const signal = controller.signal;
        const result =
          config.timeframe === 'monthly'
            ? await fetchMonthlyRevenue(config.months, signal)
            : config.timeframe === 'weekly'
              ? await fetchWeeklyRevenue(config.weeks, signal)
              : await fetchCustomRangeRevenue(
                  {
                    startDate: config.startDate,
                    endDate: config.endDate,
                    granularity: config.granularity,
                  },
                  signal
                );

        if (!active) return;
        setData(result);
        setStatus('ready');
      } catch (err) {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load revenue data');
        setData(null);
        setStatus('error');
      }
    };

    void run();

    return () => {
      active = false;
      controller.abort();
    };
    // config + refreshCount are the only inputs that change what is fetched.
  }, [config, refreshCount]);

  return {
    timeframe: config.timeframe,
    months: config.months,
    weeks: config.weeks,
    startDate: config.startDate,
    endDate: config.endDate,
    granularity: config.granularity,
    rangeDays,
    data,
    status,
    isLoading: status === 'loading' || status === 'idle',
    error,
    issue,
    canRequest,
    setTimeframe,
    setMonthlyWindow,
    setWeeklyWindow,
    setCustomRange,
    setCustomStartDate,
    setCustomEndDate,
    setGranularity,
    reset,
    refresh,
  };
};
