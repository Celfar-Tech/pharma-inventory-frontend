// Shared API client utilities used by all service modules
declare global {
  interface Window {
    process?: {
      env?: {
        REACT_APP_API_URL?: string;
      };
    };
  }
}

// In development the API is reached through the Vite dev proxy so the
// backend's cookies (SameSite=Lax/Strict) are treated as same-site instead
// of being rejected in a cross-site context. Production defaults to the
// remote API host unless VITE_API_URL is provided.
const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? '/api'
  : 'http://129.121.135.236:8080';

const normalizeApiBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '');

  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  // Keep root-relative paths (e.g. "/api" for the dev proxy) unchanged.
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
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

export const toApiError = (error: unknown, fallbackMessage: string): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
};

export const handleResponse = async (res: Response) => {
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Unauthorized: Session expired or invalid token');
  }

  return res;
};
