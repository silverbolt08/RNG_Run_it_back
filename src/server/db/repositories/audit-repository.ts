import type { InferInsertModel } from 'drizzle-orm';
import { newPublicId } from '../../../lib/ids';
import { scrubIdentifiers } from '../../../lib/mask';
import type { Clock } from '../../../lib/clock';
import type { Database } from '../client';
import { auditLog } from '../schema';

/** Counts and codes only. Who, what and when, with no personal values. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export type AuditEntry = {
  actorRef: string;
  action: string;
  objectType: string;
  objectId?: string | null;
  requestId?: string | null;
  metadata?: AuditMetadata;
};

/** For writing an audit row in the same batch as the change it records. */
export function buildAuditRow(clock: Clock, entry: AuditEntry): InferInsertModel<typeof auditLog> {
  const now = clock.now().toISOString();
  return {
    id: newPublicId('aud'),
    actorRef: entry.actorRef,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId ?? null,
    requestId: entry.requestId ?? null,
    // Scrubbed as a backstop: a value here should never be an identifier in the first place.
    metadata: entry.metadata ? scrubIdentifiers(JSON.stringify(entry.metadata)) : null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function recordAudit(app: { db: Database; clock: Clock }, entry: AuditEntry): Promise<void> {
  await app.db.insert(auditLog).values(buildAuditRow(app.clock, entry));
}
