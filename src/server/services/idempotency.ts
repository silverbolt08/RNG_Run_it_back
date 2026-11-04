import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { newPublicId } from '../../lib/ids';
import type { AppContext } from '../app-context';
import { idempotencyKeys } from '../db/schema';
import type { IdempotencyScope } from '../db/schema/enums';
import { ApiError } from '../http/errors';

export type Reservation = { replayOf: string } | { reservationId: string };

// A reservation older than this came from a request that died, so a retry may take it over.
const STALE_RESERVATION_MS = 120_000;

export function hashRequest(...parts: ReadonlyArray<string | Buffer>): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

/**
 * Claims a key before any work starts. A retry after a network drop gets the first result rather
 * than doing the work twice, and the unique index settles two requests racing for the same key.
 */
export async function reserveKey(
  app: AppContext,
  ownerId: string,
  scope: IdempotencyScope,
  key: string,
  requestHash: string,
): Promise<Reservation> {
  const now = app.clock.now();
  const reservationId = newPublicId('idm');
  const inserted = await app.db
    .insert(idempotencyKeys)
    .values({
      id: reservationId,
      ownerId,
      scope,
      key,
      requestHash,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (inserted.length > 0) return { reservationId };

  const [existing] = await app.db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.ownerId, ownerId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
    .limit(1);
  if (!existing) throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'This request is still being processed. Please wait a moment.');

  if (existing.requestHash !== requestHash) {
    throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was already used for a different request.');
  }
  if (existing.resourceId) return { replayOf: existing.resourceId };

  const age = now.getTime() - new Date(existing.createdAt).getTime();
  if (age < STALE_RESERVATION_MS) {
    throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'This request is still being processed. Please wait a moment.');
  }
  await app.db
    .update(idempotencyKeys)
    .set({ createdAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(eq(idempotencyKeys.id, existing.id));
  return { reservationId: existing.id };
}

export async function completeKey(app: AppContext, reservationId: string, resourceId: string): Promise<void> {
  await app.db
    .update(idempotencyKeys)
    .set({ resourceId, updatedAt: app.clock.now().toISOString() })
    .where(eq(idempotencyKeys.id, reservationId));
}

/** Frees a key after a failure, so the client can retry with the same one. */
export async function releaseKey(app: AppContext, reservationId: string): Promise<void> {
  await app.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, reservationId));
}
