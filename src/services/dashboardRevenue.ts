// -----------------------------------------------------------------------------
// Dashboard revenue analytics API calls.
//
// Mirrors the backend endpoints mounted behind `reqAuth` in
// pharma-inventory-backend/routes/dashboard.js (all responses are scoped to the
// logged-in user via the session cookie — no email is sent from the client):
//
//   GET /dashboard/revenue/daily?days=30                        -> trailing days (default view)
//   GET /dashboard/revenue/monthly?months=6                      -> trailing months
//   GET /dashboard/revenue/weekly?weeks=12                       -> trailing ISO weeks
//   GET /dashboard/revenue/range?startDate=&endDate=&granularity -> custom range
//
// Every endpoint returns:
//   { success, data: { timeframe, granularity, currency, range, series, summary } }
// and a failed validation returns HTTP 400 / { success: false, error }.
// -----------------------------------------------------------------------------

import { API_BASE_URL, getHeaders, handleResponse, toApiError } from './apiClient';

export type RevenueTimeframe = 'daily' | 'monthly' | 'weekly' | 'custom';
export type RevenueGranularity = 'day' | 'week' | 'month';

export interface RevenueSeriesPoint {
  label: string;
  startDate: string;
  endDate: string;
  total: number;
  invoiceCount: number;
}

export interface RevenueRange {
  startDate: string;
  endDate: string;
}

export interface RevenueBestPeriod {
  label: string;
  total: number;
}

export interface RevenueSummary {
  totalRevenue: number;
  totalInvoices: number;
  periodCount: number;
  activePeriods: number;
  averagePerPeriod: number;
  bestPeriod: RevenueBestPeriod | null;
}

export interface RevenueData {
  timeframe: RevenueTimeframe;
  granularity: RevenueGranularity;
  currency: string;
  range: RevenueRange;
  series: RevenueSeriesPoint[];
  summary: RevenueSummary;
}

export interface RevenueApiResponse {
  success: boolean;
  data?: RevenueData;
  message?: string;
  error?: string;
}

export interface CustomRangeParams {
  startDate: string;
  endDate: string;
  granularity?: RevenueGranularity;
}

const getQueryString = (params: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
};

const requestRevenue = async (
  path: string,
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal
): Promise<RevenueData> => {
  try {
    const res = await fetch(`${API_BASE_URL}${path}${getQueryString(params)}`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
      signal,
    });

    const response = await handleResponse(res);
    const body: RevenueApiResponse = await response.json().catch(() => ({
      success: false,
      error: 'Dashboard revenue API returned an invalid response',
    }));

    if (!response.ok || !body.success || !body.data) {
      throw new Error(
        body.error || body.message || `Dashboard revenue request failed (${response.status})`
      );
    }

    return body.data;
  } catch (error) {
    // Let callers handle request cancellation (component unmount / superseded request).
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw toApiError(error, 'Failed to load dashboard revenue data');
  }
};

/** Trailing calendar days of sales revenue (default 30) — the dashboard's default view. */
export const fetchDailyRevenue = (days = 30, signal?: AbortSignal): Promise<RevenueData> =>
  requestRevenue('/dashboard/revenue/daily', { days }, signal);

/** Trailing calendar months of sales revenue (default 6). */
export const fetchMonthlyRevenue = (months = 6, signal?: AbortSignal): Promise<RevenueData> =>
  requestRevenue('/dashboard/revenue/monthly', { months }, signal);

/** Trailing ISO weeks (Monday-start) of sales revenue (default 12). */
export const fetchWeeklyRevenue = (weeks = 12, signal?: AbortSignal): Promise<RevenueData> =>
  requestRevenue('/dashboard/revenue/weekly', { weeks }, signal);

/** Sales revenue for an inclusive custom date range, bucketed by day/week/month. */
export const fetchCustomRangeRevenue = (
  range: CustomRangeParams,
  signal?: AbortSignal
): Promise<RevenueData> =>
  requestRevenue(
    '/dashboard/revenue/range',
    {
      startDate: range.startDate,
      endDate: range.endDate,
      granularity: range.granularity ?? 'day',
    },
    signal
  );
