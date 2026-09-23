// Shared API client utilities used by all service modules.
//
// The API authenticates with an httpOnly session cookie, so every request must
// be sent with `credentials: 'include'`. During local development the browser
// talks to the Vite dev server (`VITE_API_URL=/api`), which proxies `/api/*` to
// the dev backend — see `server.proxy` in `vite.config.ts`. Keeping those calls
// same-origin is what lets the session cookie be stored and replayed locally.
declare global {
  interface Window {
    process?: {
      env?: {
        REACT_APP_API_URL?: string;
      };
    };
  }
}

// Hosts used when `VITE_API_URL` is not provided. Vite loads `.env.development`
// for `npm run dev`, so localhost development talks to the dev backend while
// production builds fall back to the public API host. Act as a senior developer and check this code I want user logic in every query 
const DEV_API_BASE_URL = 'https://dev.api.pharma-connect.in';
const PROD_API_BASE_URL = 'https://api.pharma-connect.in';

// `VITE_API_URL` always wins; otherwise pick the host that matches the mode.
const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? DEV_API_BASE_URL
  : PROD_API_BASE_URL;

const normalizeApiBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '');

  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  // Keep root-relative paths unchanged.
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const rawApiBaseUrl =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.process?.env?.REACT_APP_API_URL) ||
  DEFAULT_API_BASE_URL;

export const API_BASE_URL = normalizeApiBaseUrl(rawApiBaseUrl);

export const getHeaders = (): HeadersInit => {
  return {
    'Content-Type': 'application/json',
  };
};

/** API error that keeps the HTTP status so callers can react to it. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Builds an `ApiError` from a failed response and its (optional) body. */
export const toResponseError = (
  res: Response,
  body: { error?: string; message?: string } | null | undefined,
  fallbackMessage: string,
): ApiError =>
  new ApiError(body?.error || body?.message || fallbackMessage, res.status);

export const toApiError = (error: unknown, fallbackMessage: string): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
};

export const handleResponse = async (res: Response) => {
  if (res.status === 401) {
    window.location.href = '/';
    throw new ApiError('Unauthorized: Session expired or invalid token', 401);
  }

  return res;
};
