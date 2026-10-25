import type { ApiErrorBody, HealthResponse } from './types';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string;

  constructor(options: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details ?? null;
    this.requestId = options.requestId ?? '';
  }
}

type JsonRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      'message' in error &&
      typeof (error as { code: unknown }).code === 'string' &&
      typeof (error as { message: unknown }).message === 'string',
  );
}

/** One URL policy for JSON requests and calendar downloads. Never accepts an external path. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/api/') || /[\\#\u0000-\u0020]/.test(path) || path.split('?')[0].includes('..')) {
    throw new ApiError({ code: 'invalid_path', message: 'This request is not a Raincheck API path.', status: 0 });
  }
  const base = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!base) return path;
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid base');
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${path}`;
  } catch {
    throw new ApiError({ code: 'invalid_api_base', message: 'The Raincheck API address is not configured correctly.', status: 0 });
  }
}

/** Typed fetch: non-2xx becomes ApiError; network failure uses code "network_error". */
export async function apiFetch<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
  const url = apiUrl(path);
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      body,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
    throw new ApiError({
      code: 'network_error',
      message: 'Raincheck could not reach the desk. Check your connection and try again.',
      status: 0,
    });
  }

  const requestId = response.headers.get('X-Request-ID') ?? '';
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError({ code: 'network_error', message: 'The connection ended early. Please try again.', status: 0 });
  }
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError({
        code: payload.error.code,
        message: payload.error.message,
        status: response.status,
        details: payload.error.details,
        requestId: payload.error.request_id || requestId,
      });
    }
    throw new ApiError({
      code: 'http_error',
      message: 'The desk answered in an unexpected way. Please try again.',
      status: response.status,
      requestId,
    });
  }

  if (payload === null) {
    throw new ApiError({ code: 'invalid_response', message: 'The desk returned an unreadable response. Please try again.', status: response.status });
  }
  return payload as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/api/health', { signal });
}
