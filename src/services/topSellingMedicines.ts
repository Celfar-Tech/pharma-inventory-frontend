// -----------------------------------------------------------------------------
// Top-selling medicines API calls — "which medicines sold the most in this window?".
//
// Mirrors the two backend endpoints mounted behind `reqAuth` in
// pharma-inventory-backend/routes/dashboard.js:
//
//   GET  /dashboard/top-selling-medicines?days=30&limit=50&sortBy=quantity
//   POST /dashboard/top-selling-medicines/refresh   -> rebuild the rollup
//
// Both are scoped to the logged-in user by the session cookie: the backend reads
// pharma.mv_daily_medicine_sales filtered by created_by = req.user.email, so no email
// is ever sent from the client.
//
// The GET returns a single ranked leaderboard — one row per medicine with its total units
// sold and total revenue across the whole window (last 30 days by default, or an explicit
// startDate/endDate override). Rows come back ordered by `sortBy` (`quantity` | `revenue`),
// and the server ranks the capped page, so the response is a true top-N for that metric.
// Failures:
//
//   400  { success: false, error }        bad days/limit/sortBy/date span
//   401  handled globally by `handleResponse` (hard redirect to '/')
//   503  { success: false, error, hint }  pharma.mv_daily_medicine_sales is missing
//
// The 503 means the rollup has never been provisioned, so the body carries a `hint`
// (apply the MV SQL, or POST the refresh endpoint). `TopSellingError` preserves that hint
// plus the HTTP status, letting the dashboard offer a one-click rebuild instead of a
// dead-end error message.
// -----------------------------------------------------------------------------

import { API_BASE_URL, ApiError, getHeaders, handleResponse, toApiError } from './apiClient';

/** Ranking metric accepted by `sortBy` (mirrors the backend `TOP_SELLING_SORTS`). */
export type TopSellingSortBy = 'quantity' | 'revenue';

/** Every accepted metric — the fallback list for the UI's "sort by" control. */
export const TOP_SELLING_SORTS: readonly TopSellingSortBy[] = ['quantity', 'revenue'];

/** One medicine on the leaderboard, already summed across the whole window. */
export interface TopSellingMedicine {
  /** 1-based position as ranked by the requested metric. */
  rank: number;
  /** Null for legacy billing line items that were saved without a medicine id. */
  medicineId: number | null;
  medicineName: string;
  totalQuantitySold: number;
  totalRevenue: number;
}

/**
 * "Records to show" contract echoed by the API. `limit` is the page size that was applied,
 * `options` the page sizes the backend suggests for the dropdown, and `max` the hard cap
 * (`limit` above `max` is a 400, not a clamp).
 */
export interface TopSellingPageSize {
  limit: number;
  options: number[];
  max: number;
}

export interface TopSellingData {
  currency: string;
  /** Inclusive window the numbers cover (already resolved server-side). */
  range: { startDate: string; endDate: string };
  /** Trailing days the server applied; the explicit range may override it. */
  lookbackDays: number;
  /**
   * Latest business day present in the rollup, or `null` when the owner has no
   * rows. The rollup is a snapshot, so render it as "as of <dataThrough>".
   */
  dataThrough: string | null;
  /** Rollup the numbers came from — for debugging/telemetry. */
  source: string;
  /** Which metric the server ranked by, plus every accepted value. */
  sort: { by: TopSellingSortBy; options: TopSellingSortBy[] };
  /**
   * Page-size metadata for the "records to show" dropdown. Optional because older
   * deployments predate the contract — the UI falls back to its own option list.
   */
  pageSize?: TopSellingPageSize | null;
  /** Flat leaderboard rows, already ordered by `sort.by`. At most `pageSize.limit` rows. */
  series: TopSellingMedicine[];
  summary: {
    medicineCount: number;
    totalQuantitySold: number;
    totalRevenue: number;
    /** Best medicine by each metric, so the UI can label its toggle without re-deriving. */
    bestByQuantity: TopSellingMedicine | null;
    bestByRevenue: TopSellingMedicine | null;
  };
}

export interface TopSellingParams {
  /** Trailing calendar days, 1-370 (default 30). Ignored when startDate/endDate are sent. */
  days?: number;
  /** Max medicines returned, 1-200 (default 50) — the "records to show" page size. */
  limit?: number;
  /** Ranking metric; the server returns the page ordered by it. */
  sortBy?: TopSellingSortBy;
  /** Optional inclusive window override (YYYY-MM-DD). */
  startDate?: string;
  endDate?: string;
}

export interface TopSellingRefreshParams {
  /** Bypass the backend's debounce window and rebuild now. */
  force?: boolean;
  /** `false` forces a blocking rebuild instead of REFRESH ... CONCURRENTLY. */
  concurrently?: boolean;
}

export interface TopSellingRefreshResult {
  /** `false` when the call was debounced and no rebuild ran. */
  refreshed: boolean;
  concurrently?: boolean;
  durationMs?: number;
  lastRefreshedAt?: string | null;
  /** Seconds until the next rebuild is allowed (0 when the debounce is off). */
  nextAllowedInSeconds?: number;
  /** Why a call was skipped, e.g. "debounced". */
  reason?: string;
}

interface TopSellingEnvelope {
  success: boolean;
  data?: TopSellingData;
  error?: string;
  message?: string;
  hint?: string;
}

interface TopSellingRefreshEnvelope {
  success: boolean;
  data?: TopSellingRefreshResult;
  error?: string;
  message?: string;
  hint?: string;
}

/**
 * Rollup-backed endpoint failure. Keeps the HTTP status (so 503 "not provisioned"
 * can be told apart from 400 "bad params") and the backend's actionable `hint`.
 */
export class TopSellingError extends ApiError {
  readonly hint: string | null;

  constructor(message: string, status: number, hint: string | null = null) {
    super(message, status);
    this.name = 'TopSellingError';
    this.hint = hint;
  }
}

const TOP_SELLING_PATH = '/dashboard/top-selling-medicines';

const buildQuery = (params: TopSellingParams): string => {
  const query = new URLSearchParams();
  if (params.days !== undefined) query.set('days', String(params.days));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
};

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError');

/**
 * Ranked leaderboard of the best-selling medicines over a date window.
 *
 * @param params Trailing window (`days`), page size (`limit`), rank metric (`sortBy`), or an
 *   explicit `startDate`/`endDate` override.
 * @param signal Aborts the request when the caller's selection changes.
 */
export const fetchTopSellingMedicines = async (
  params: TopSellingParams = {},
  signal?: AbortSignal
): Promise<TopSellingData> => {
  try {
    const res = await fetch(`${API_BASE_URL}${TOP_SELLING_PATH}${buildQuery(params)}`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
      signal,
    });

    const response = await handleResponse(res);
    const body: TopSellingEnvelope = await response.json().catch(() => ({ success: false }));

    if (!response.ok || !body.success || !body.data) {
      throw new TopSellingError(
        body.error || body.message || `Top-selling medicines request failed (${response.status})`,
        response.status,
        body.hint ?? null
      );
    }

    return body.data;
  } catch (error) {
    // Let callers handle request cancellation (component unmount / superseded request).
    if (isAbortError(error)) {
      throw error;
    }
    throw toApiError(error, 'Failed to load top-selling medicines');
  }
};

/**
 * Rebuilds `pharma.mv_daily_medicine_sales` so the GET above picks up new sales.
 *
 * This is a *maintenance* action: one rebuild covers every owner, so it is debounced
 * by the backend to at most one run per `MV_REFRESH_MIN_INTERVAL_SECONDS` (default
 * 300s). A debounced call resolves with `refreshed: false` plus a `reason` instead
 * of throwing — pass `force: true` to rebuild regardless.
 */
export const refreshTopSellingMedicines = async (
  params: TopSellingRefreshParams = {}
): Promise<TopSellingRefreshResult> => {
  try {
    const res = await fetch(`${API_BASE_URL}${TOP_SELLING_PATH}/refresh`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(params),
    });

    const response = await handleResponse(res);
    const body: TopSellingRefreshEnvelope = await response.json().catch(() => ({ success: false }));

    if (!response.ok || !body.success || !body.data) {
      throw new TopSellingError(
        body.error || body.message || `Rollup refresh failed (${response.status})`,
        response.status,
        body.hint ?? null
      );
    }

    return body.data;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw toApiError(error, 'Failed to rebuild the sales rollup');
  }
};
