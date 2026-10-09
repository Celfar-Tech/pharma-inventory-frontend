// Order Book — persistence for the "medicines to order later" list.
//
// Entries are stored server-side against the user's account (the
// `pharma.book_ledger` / `pharma.book_items` tables served by the `/book`
// endpoints), so the book follows the account instead of the browser. There is
// no browser-side copy: every read and write goes to the API, and a request that
// fails surfaces as an error instead of silently diverging into a second store.
// This module is the ONLY place that knows the endpoint paths and response shape.

import {
  API_BASE_URL,
  getHeaders,
  handleResponse,
  toApiError,
  toResponseError,
} from './apiClient';

export interface OrderBookEntry {
  id: string;
  /** Catalogue `sku_id` when the medicine was picked from the suggestions. */
  medicineId: number | null;
  /** Merge key: `id:<sku>` when known, otherwise `name:<lowercased name>`. */
  key: string;
  name: string;
  manufacturer: string;
  composition: string;
  packSize: string;
  quantity: number;
  /** Expected unit price in rupees. `0` means "not decided yet". */
  price: number;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

/** A line that was marked as ordered (moved out of the active book). */
export interface OrderHistoryEntry extends OrderBookEntry {
  /** When the line was marked as ordered. */
  orderedAt: string;
}

/**
 * One placed order. `GET /book/history` returns these summaries (newest first)
 * and *not* the medicines themselves — the lines live in `book_items` and are
 * loaded per-ledger with `getLedgerItems` only when a row is expanded.
 */
export interface OrderLedger {
  ledgerId: string;
  /** When the order was placed (ISO). */
  date: string;
  orderedAt: string;
  supplierName: string;
  supplierEmail: string;
  /** Number of distinct medicines in the order. */
  itemCount: number;
  /** Approximate order cost in rupees. */
  approxCost: number;
  status: string;
}

/** A single ledger together with the medicines it holds (expand-on-demand). */
export interface OrderLedgerDetail {
  ledger: OrderLedger;
  items: OrderHistoryEntry[];
}

export interface OrderBookInput {
  medicineId?: number | null;
  name: string;
  manufacturer?: string;
  composition?: string;
  packSize?: string;
  quantity: number;
  price?: number;
  remark?: string;
}

export interface BookMutationResult {
  entries: OrderBookEntry[];
  /** The line that was created or merged into (upsert/update only). */
  entry?: OrderBookEntry;
  /** `true` when the input matched an existing line instead of adding one. */
  merged?: boolean;
}

export interface PlaceOrderResult {
  entries: OrderBookEntry[];
  /** Summary of every placed order, newest first. */
  history: OrderLedger[];
  /** The lines that were just moved into history. */
  placed: OrderHistoryEntry[];
  /** The ledger the new order was written to, when one was created. */
  ledgerId: string | null;
}

export interface PlaceOrderInput {
  ids: string[];
  supplierName: string;
  supplierEmail: string;
}

interface BookApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Coerces one API record back into a valid entry, dropping anything nameless. */
const normalizeEntry = (raw: unknown): OrderBookEntry | null => {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const name = asText(record.name).trim();
  if (!name) return null;

  const medicineId =
    typeof record.medicineId === 'number' && Number.isFinite(record.medicineId)
      ? record.medicineId
      : null;

  return {
    id: asText(record.id),
    medicineId,
    key:
      medicineId !== null ? `id:${medicineId}` : `name:${name.toLowerCase()}`,
    name,
    manufacturer: asText(record.manufacturer),
    composition: asText(record.composition),
    packSize: asText(record.packSize),
    quantity: Math.max(0, toNumber(record.quantity, 0)),
    price: Math.max(0, toNumber(record.price, 0)),
    remark: asText(record.remark),
    createdAt: asText(record.createdAt),
    updatedAt: asText(record.updatedAt),
  };
};

const normalizeHistoryEntry = (raw: unknown): OrderHistoryEntry | null => {
  const entry = normalizeEntry(raw);
  if (!entry) return null;
  const orderedAt = asText((raw as Record<string, unknown>).orderedAt) || entry.updatedAt;
  return { ...entry, orderedAt };
};

/** Shared fetch helper: attaches the session cookie and parses the JSON body. */
const request = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<BookApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}/book${path}`, {
    ...options,
    headers: getHeaders(),
    credentials: 'include',
  });

  const response = await handleResponse(res);
  const body: BookApiResponse<T> = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Keep the HTTP status on the error so a rejected payload can be told apart
    // from a request the deployment could not route.
    throw toResponseError(response, body, `Book request failed (HTTP ${response.status})`);
  }

  return body;
};

const readEntries = (data: unknown): OrderBookEntry[] =>
  Array.isArray(data)
    ? data
        .map(normalizeEntry)
        .filter((entry): entry is OrderBookEntry => entry !== null)
    : [];

const readHistory = (data: unknown): OrderHistoryEntry[] =>
  Array.isArray(data)
    ? data
        .map(normalizeHistoryEntry)
        .filter((entry): entry is OrderHistoryEntry => entry !== null)
    : [];

/** Coerces one API ledger row, dropping anything without a ledger id. */
const normalizeLedger = (raw: unknown): OrderLedger | null => {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const ledgerId = asText(record.ledgerId).trim();
  if (!ledgerId) return null;

  const date = asText(record.date) || asText(record.orderedAt);

  return {
    ledgerId,
    date,
    orderedAt: asText(record.orderedAt) || date,
    supplierName: asText(record.supplierName),
    supplierEmail: asText(record.supplierEmail),
    itemCount: Math.max(0, toNumber(record.itemCount, 0)),
    approxCost: Math.max(0, toNumber(record.approxCost, 0)),
    status: asText(record.status) || 'ordered',
  };
};

const readLedgers = (data: unknown): OrderLedger[] =>
  Array.isArray(data)
    ? data.map(normalizeLedger).filter((ledger): ledger is OrderLedger => ledger !== null)
    : [];

/** Reads every active line, newest first. */
export const getBookEntries = async (): Promise<OrderBookEntry[]> => {
  try {
    const body = await request<OrderBookEntry[]>('/entries');
    return readEntries(body.data);
  } catch (error) {
    throw toApiError(error, 'Failed to load the order book');
  }
};

/**
 * Reads every order placed, newest first — the order summaries only.
 *
 * Each row shown in the history list comes from here; the medicines inside an
 * order are deliberately not joined in (see `getLedgerItems`).
 */
export const getBookHistory = async (): Promise<OrderLedger[]> => {
  try {
    const body = await request<OrderLedger[]>('/history');
    return readLedgers(body.data);
  } catch (error) {
    throw toApiError(error, 'Failed to load order history');
  }
};

/**
 * Loads one placed order with its medicines. Intended to run only when the user
 * expands a history row, so the history list itself stays a single request.
 */
export const getLedgerItems = async (ledgerId: string): Promise<OrderLedgerDetail> => {
  try {
    const body = await request<{ ledger?: unknown; items?: unknown }>(
      `/history/${encodeURIComponent(ledgerId)}`,
    );

    const data = body.data;
    const ledger = normalizeLedger(data?.ledger);
    if (!ledger) {
      throw new Error('That order could not be found.');
    }

    return { ledger, items: readHistory(data?.items) };
  } catch (error) {
    throw toApiError(error, 'Failed to load the order details');
  }
};

/**
 * Adds a line, or — when the same medicine is already on the list — folds the
 * quantity into the existing line so the book never grows duplicate rows.
 */
export const upsertBookEntry = async (
  input: OrderBookInput,
): Promise<BookMutationResult> => {
  try {
    const body = await request<BookMutationResult>('/upsert', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    const data = body.data;
    return {
      entries: readEntries(data?.entries),
      entry: data?.entry ? normalizeEntry(data.entry) ?? undefined : undefined,
      merged: Boolean(data?.merged),
    };
  } catch (error) {
    throw toApiError(error, 'Failed to add to the order book');
  }
};

/** Patches an existing line. A missing id is a no-op, not a crash. */
export const updateBookEntry = async (
  id: string,
  patch: Partial<OrderBookInput>,
): Promise<BookMutationResult> => {
  try {
    const body = await request<BookMutationResult>(`/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });

    const data = body.data;
    return {
      entries: readEntries(data?.entries),
      entry: data?.entry ? normalizeEntry(data.entry) ?? undefined : undefined,
    };
  } catch (error) {
    throw toApiError(error, 'Failed to update the order book line');
  }
};

export const removeBookEntry = async (id: string): Promise<OrderBookEntry[]> => {
  try {
    const body = await request<OrderBookEntry[]>(`/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return readEntries(body.data);
  } catch (error) {
    throw toApiError(error, 'Failed to remove the order book line');
  }
};

export const clearBookEntries = async (): Promise<OrderBookEntry[]> => {
  try {
    const body = await request<OrderBookEntry[]>('/clear', {
      method: 'DELETE',
    });
    return readEntries(body.data);
  } catch (error) {
    throw toApiError(error, 'Failed to clear the order book');
  }
};

/** Moves the selected lines out of the book and into order history. */
export const placeOrderBookEntries = async (
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> => {
  try {
    const body = await request<PlaceOrderResult>('/place-order', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    const data = body.data;
    return {
      entries: readEntries(data?.entries),
      history: readLedgers(data?.history),
      placed: readHistory(data?.placed),
      ledgerId: data?.ledgerId == null ? null : String(data.ledgerId),
    };
  } catch (error) {
    throw toApiError(error, 'Failed to mark the order book lines as ordered');
  }
};
