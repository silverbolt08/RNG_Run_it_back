import { z } from 'zod';
import { invalidRequest } from './errors';

/** Field paths and rule codes only. A Zod message or value could repeat what the owner typed. */
function issuesOf(error: z.ZodError): Array<{ path: string; code: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
}

// No JSON request here comes close to this. Uploads go through their own limit.
const MAX_JSON_BYTES = 64 * 1024;

/** An empty body counts as `{}`, so action routes with no fields still reject unknown ones. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const tooBig = invalidRequest([{ path: '', code: 'too_big' }]);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) throw tooBig;

  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw tooBig;

  let value: unknown = {};
  if (text.trim() !== '') {
    try {
      value = JSON.parse(text);
    } catch {
      throw invalidRequest();
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequest(issuesOf(parsed.error));
  return parsed.data;
}

export function readQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const values = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(values);
  if (!parsed.success) throw invalidRequest(issuesOf(parsed.error));
  return parsed.data;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export function readIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw invalidRequest([{ path: 'Idempotency-Key', code: 'required' }]);
  }
  return key;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const pageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Expects `limit + 1` rows, so it knows whether another page exists without a count. */
export function toPage<T, V>(rows: readonly T[], limit: number, cursorOf: (row: T) => string, view: (row: T) => V): Page<V> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items: items.map(view), nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}
