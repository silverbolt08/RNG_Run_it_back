/** The browser's way to the API. Every failure becomes an ApiFailure, so screens handle one shape. */
export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiFailure';
  }
}

export const NETWORK_FAILURE = 'NETWORK';

type RequestOptions = { body?: unknown; form?: FormData; idempotencyKey?: string; adminToken?: string };

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.adminToken) headers['x-admin-token'] = options.adminToken;

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch {
    throw new ApiFailure(0, NETWORK_FAILURE);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiFailure(response.status, error?.code ?? 'UNKNOWN', error?.details ?? {});
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { body, ...options }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { body, ...options }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData, idempotencyKey: string) => request<T>('POST', path, { form, idempotencyKey }),
};

/** One key per action, and reused on a retry so a dropped connection can't do the work twice. */
export function newIdempotencyKey(): string {
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

/** The session cookie is HttpOnly, so this simply asks the server to make sure there is one. */
export async function ensureSession(): Promise<void> {
  await api.post('/sessions');
}

const DATE_LOCALES = { en: 'en-IN', hi: 'hi-IN' } as const;

export function formatDate(isoDate: string, locale: 'en' | 'hi'): string {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate.slice(0, 10)}T00:00:00Z`),
  );
}
