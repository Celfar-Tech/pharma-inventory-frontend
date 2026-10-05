// -----------------------------------------------------------------------------
// useTopSellingMedicines — data hook behind the dashboard's "Top sellers" card.
//
// Wraps GET /dashboard/top-selling-medicines (a single ranked leaderboard over a date
// window) and the POST .../refresh maintenance call that rebuilds the
// pharma.mv_daily_medicine_sales rollup behind it.
//
// State owned here:
//   * range               trailing 30 days by default, or an explicit [startDate, endDate]
//   * sortBy              ranking metric — quantity (units sold) | revenue
//   * pageSize            records to show (sent as the API `limit`)
//   * fetch lifecycle     idle | loading | ready | error
//   * needsRollup         true when the backend reported the rollup is not provisioned
//   * isRefreshingRollup  the rebuild POST is in flight
//
// The range is deliberately ONE concept: leaving `startDate`/`endDate` empty means "trailing
// DEFAULT_TOP_RANGE_DAYS days", which the server anchors to its own business date
// (Asia/Kolkata) instead of the browser clock. Picking a range sends explicit dates instead.
//
// `refreshRollup()` rebuilds the rollup and re-runs the GET only when a rebuild actually
// happened; a debounced rebuild (`refreshed: false`) resolves with the backend's reason so
// the caller can explain why nothing changed.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TOP_SELLING_SORTS,
  TopSellingError,
  fetchTopSellingMedicines,
  refreshTopSellingMedicines,
} from '../services/topSellingMedicines';
import type {
  TopSellingData,
  TopSellingRefreshParams,
  TopSellingRefreshResult,
  TopSellingSortBy,
} from '../services/topSellingMedicines';

export type TopSellingStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Trailing window used until the user picks a custom range (the backend `DEFAULT_DAYS`). */
export const DEFAULT_TOP_RANGE_DAYS = 30;
/** Longest custom window the backend accepts (its `MAX_RANGE_DAYS.day`). */
export const MAX_TOP_RANGE_DAYS = 370;
/** Page sizes the "records to show" dropdown offers, smallest first. */
export const TOP_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];
/** Records shown before the user touches the dropdown (the backend `DEFAULT_TOP_MEDICINES`). */
export const DEFAULT_TOP_PAGE_SIZE = 50;

/** A custom range the user is still building, or has entered. */
export interface TopSellingRange {
  /** Inclusive range start (YYYY-MM-DD); '' means "not picked". */
  startDate: string;
  /** Inclusive range end (YYYY-MM-DD); '' means "not picked". */
  endDate: string;
}

export interface TopSellingRangeIssue {
  kind: 'incomplete' | 'reversed' | 'tooLong' | 'future';
  message: string;
}

export interface TopSellingAnalytics {
  // ---- current selection ----------------------------------------------------
  /** Trailing window used when no custom range is set. */
  days: number;
  /** Inclusive range start (YYYY-MM-DD); '' while the default window is active. */
  startDate: string;
  /** Inclusive range end (YYYY-MM-DD); '' while the default window is active. */
  endDate: string;
  /** True once the user has picked any custom date. */
  isCustom: boolean;
  /** Client-side validation for the current range; null when it is fetchable. */
  rangeIssue: TopSellingRangeIssue | null;
  /** Metric the leaderboard is ranked by. */
  sortBy: TopSellingSortBy;
  /** Metrics the "sort by" control may offer. */
  sortOptions: TopSellingSortBy[];
  /** How many records the list renders — always one of `pageSizeOptions`. */
  pageSize: number;
  /**
   * Page sizes the dropdown may offer: the app's preferred list (10/25/50/100) capped by the
   * API's `pageSize.max`, so the UI can never select a size the backend would reject.
   */
  pageSizeOptions: number[];

  // ---- fetch lifecycle ------------------------------------------------------
  data: TopSellingData | null;
  status: TopSellingStatus;
  isLoading: boolean;
  error: string | null;
  /** Actionable hint the backend sends with a 503; null otherwise. */
  hint: string | null;
  /** HTTP status behind the current error, or null when the request succeeded. */
  errorStatus: number | null;
  /** True when the rollup has not been provisioned — only a rebuild can help. */
  needsRollup: boolean;
  isRefreshingRollup: boolean;

  // ---- imperative controls --------------------------------------------------
  /** Set the custom range (a picker passes `[start, end]`; either half may be null). */
  setRange: (value: [string | null, string | null]) => void;
  /** Drop the custom range and go back to the trailing default window. */
  clearRange: () => void;
  setSortBy: (sortBy: TopSellingSortBy) => void;
  /** Change how many records the list shows; re-reads the ranked page. */
  setPageSize: (size: number) => void;
  /** Re-run the GET for the current selection (used by the reload + retry buttons). */
  refresh: () => void;
  /** Rebuild the sales rollup; re-reads the data when the rebuild actually ran. */
  refreshRollup: (params?: TopSellingRefreshParams) => Promise<TopSellingRefreshResult>;
}

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError');

const pad = (value: number): string => String(value).padStart(2, '0');

/** Today as a local YYYY-MM-DD string. */
const localTodayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Inclusive day count between two YYYY-MM-DD dates (UTC math, so DST cannot shift it). */
const daysInRange = (startDate: string, endDate: string): number => {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / 86_400_000) + 1;
};

/** Client-side gate used before any custom-range request is fired. */
export const evaluateRangeIssue = (range: TopSellingRange): TopSellingRangeIssue | null => {
  const { startDate, endDate } = range;
  const hasStart = startDate !== '';
  const hasEnd = endDate !== '';

  // Neither half picked yet → the trailing default window; nothing to validate.
  if (!hasStart && !hasEnd) return null;
  if (!hasStart || !hasEnd) {
    return { kind: 'incomplete', message: 'Select both a start and an end date.' };
  }
  if (startDate > endDate) {
    return { kind: 'reversed', message: 'Start date must be on or before the end date.' };
  }
  if (daysInRange(startDate, endDate) > MAX_TOP_RANGE_DAYS) {
    return { kind: 'tooLong', message: `Date range cannot exceed ${MAX_TOP_RANGE_DAYS} days.` };
  }
  if (endDate > localTodayIso()) {
    return { kind: 'future', message: 'End date cannot be in the future.' };
  }
  return null;
};

const EMPTY_RANGE: TopSellingRange = { startDate: '', endDate: '' };

export const useTopSellingMedicines = (): TopSellingAnalytics => {
  const [range, setRangeState] = useState<TopSellingRange>(EMPTY_RANGE);
  const [sortBy, setSortByState] = useState<TopSellingSortBy>('quantity');
  const [selectedPageSize, setSelectedPageSize] = useState<number>(DEFAULT_TOP_PAGE_SIZE);

  const [data, setData] = useState<TopSellingData | null>(null);
  const [status, setStatus] = useState<TopSellingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [isRefreshingRollup, setIsRefreshingRollup] = useState(false);

  const rangeIssue = useMemo(() => evaluateRangeIssue(range), [range]);

  const setRange = useCallback((value: [string | null, string | null]): void => {
    setRangeState({ startDate: value[0] ?? '', endDate: value[1] ?? '' });
  }, []);

  const clearRange = useCallback((): void => setRangeState(EMPTY_RANGE), []);

  const refresh = (): void => setRefreshCount((count) => count + 1);

  // ---------------------------------------------------------------------------
  // Records to show. The payload states its own ceiling (`pageSize.max`) and rejects
  // anything above it, so the dropdown is derived from what the server accepts.
  // ---------------------------------------------------------------------------
  const maxPageSize = data?.pageSize?.max ?? DEFAULT_TOP_PAGE_SIZE;

  const pageSizeOptions = useMemo<number[]>(() => {
    const serverOptions = data?.pageSize?.options ?? [];
    const allowed = [...new Set([...serverOptions, ...TOP_PAGE_SIZE_OPTIONS])]
      .filter((size) => size <= maxPageSize)
      .sort((a, b) => a - b);
    // A deployment with a cap below our smallest size still needs one selectable option.
    return allowed.length > 0 ? allowed : [Math.max(1, maxPageSize)];
  }, [data, maxPageSize]);

  /** Never let the selection fall outside the offered set (e.g. the cap shrank). */
  const pageSize = useMemo<number>(() => {
    if (pageSizeOptions.includes(selectedPageSize)) return selectedPageSize;
    const nextSmallest = pageSizeOptions.filter((size) => size < selectedPageSize).pop();
    return nextSmallest ?? pageSizeOptions[0];
  }, [pageSizeOptions, selectedPageSize]);

  /** Which metrics the "sort by" control may offer, taken from the API when it says so. */
  const sortOptions = useMemo<TopSellingSortBy[]>(() => {
    const serverOptions = data?.sort?.options ?? [];
    const merged = [...new Set([...serverOptions, ...TOP_SELLING_SORTS])];
    return merged.length > 0 ? merged : [...TOP_SELLING_SORTS];
  }, [data]);

  // ---------------------------------------------------------------------------
  // Fetch effect — fires once per selection change (or explicit refresh). A stale
  // request is aborted when a newer selection supersedes it or the hook unmounts.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const issue = evaluateRangeIssue(range);

    const run = async (): Promise<void> => {
      // A blocked range never hits the network — the card renders the issue instead.
      if (issue !== null) {
        if (!active) return;
        setData(null);
        setError(null);
        setHint(null);
        setErrorStatus(null);
        setStatus('idle');
        return;
      }

      if (active) {
        setStatus('loading');
        setError(null);
        setHint(null);
        setErrorStatus(null);
      }

      try {
        const result = await fetchTopSellingMedicines(
          {
            days: DEFAULT_TOP_RANGE_DAYS,
            limit: pageSize,
            sortBy,
            ...(range.startDate && range.endDate
              ? { startDate: range.startDate, endDate: range.endDate }
              : {}),
          },
          controller.signal
        );

        if (!active) return;
        setData(result);
        setStatus('ready');
      } catch (err) {
        if (!active) return;
        if (isAbortError(err)) return;

        setData(null);
        setError(err instanceof Error ? err.message : 'Failed to load top-selling medicines');
        setHint(err instanceof TopSellingError ? err.hint : null);
        setErrorStatus(err instanceof TopSellingError ? err.status : null);
        setStatus('error');
      }
    };

    void run();

    return () => {
      active = false;
      controller.abort();
    };
    // The range, metric and page size are the only inputs that change what is fetched.
  }, [range, sortBy, pageSize, refreshCount]);

  // ---------------------------------------------------------------------------
  // Rollup rebuild. A rebuild is global (it covers every owner), so on success we
  // re-read the current window instead of trying to patch the cached payload.
  // ---------------------------------------------------------------------------
  const refreshRollup = useCallback(
    async (params: TopSellingRefreshParams = {}): Promise<TopSellingRefreshResult> => {
      setIsRefreshingRollup(true);
      try {
        const result = await refreshTopSellingMedicines(params);
        if (result.refreshed) {
          setRefreshCount((count) => count + 1);
        }
        return result;
      } finally {
        setIsRefreshingRollup(false);
      }
    },
    []
  );

  return {
    days: DEFAULT_TOP_RANGE_DAYS,
    startDate: range.startDate,
    endDate: range.endDate,
    isCustom: range.startDate !== '' || range.endDate !== '',
    rangeIssue,
    sortBy,
    sortOptions,
    pageSize,
    pageSizeOptions,
    data,
    status,
    isLoading: status === 'loading',
    error,
    hint,
    errorStatus,
    // 503 is the backend's "rollup not provisioned" signal; nothing but a rebuild fixes it.
    // An actionable `hint` counts too, so a rollup error delivered under another status
    // (an older deployment answers a bare 500) still surfaces the rebuild CTA.
    needsRollup: status === 'error' && (errorStatus === 503 || hint !== null),
    isRefreshingRollup,
    setRange,
    clearRange,
    setSortBy: setSortByState,
    setPageSize: setSelectedPageSize,
    refresh,
    refreshRollup,
  };
};
