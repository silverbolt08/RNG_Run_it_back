import { and, eq, isNotNull, lte, ne, notInArray, or } from 'drizzle-orm';
import type { AppContext } from '../app-context';
import { appendErased } from '../consent/consent-service';
import { recordAudit } from '../db/repositories/audit-repository';
import {
  conversations,
  idempotencyKeys,
  kycApplications,
  kycDocuments,
  orders,
  otpChallenges,
  owners,
  quotes,
  sessions,
} from '../db/schema';
import { deleteDocumentFile, eraseApplication } from '../services/kyc/kyc-erasure';
import { RETENTION_POLICY } from './retention-policy';

export type RetentionReport = {
  rawDocumentsDeleted: number;
  conversationsDeleted: number;
  applicationsErased: number;
  abandonedQuotesDeleted: number;
  abandonedOwnersDeleted: number;
  sessionsDeleted: number;
  otpChallengesDeleted: number;
  idempotencyKeysDeleted: number;
};

const MS_PER_DAY = 86_400_000;
const DEFAULT_INTERVAL_MS = MS_PER_DAY;

/**
 * Runs each rule against system time, not the business date, because real data ages in real time.
 * Seeded `leads` are left alone: they are reference data from the data pack, and a lead the owner
 * abandons here shows up as a quote and an owner record, which this job does erase.
 */
export async function runRetention(app: AppContext, requestId?: string): Promise<RetentionReport> {
  const now = app.clock.now();
  const daysAgo = (days: number) => new Date(now.getTime() - days * MS_PER_DAY).toISOString();

  // In this order because of foreign keys: an owner can only go once what it holds has gone.
  const rawDocumentsDeleted = await deleteExpiredRawDocuments(app, daysAgo(RETENTION_POLICY.rawDocumentDaysAfterVerification));
  const conversationsDeleted = (
    await app.db
      .delete(conversations)
      .where(lte(conversations.updatedAt, daysAgo(RETENTION_POLICY.advisorConversationDays)))
      .returning({ id: conversations.id })
  ).length;
  const abandonedBefore = daysAgo(RETENTION_POLICY.abandonedLeadDays);
  const applicationsErased = await eraseExpiredApplications(app, now, abandonedBefore);
  const abandonedQuotesDeleted = await deleteAbandonedQuotes(app, abandonedBefore);
  const idempotencyKeysDeleted = (
    await app.db
      .delete(idempotencyKeys)
      .where(lte(idempotencyKeys.updatedAt, daysAgo(RETENTION_POLICY.idempotencyKeyDays)))
      .returning({ id: idempotencyKeys.id })
  ).length;
  const otpChallengesDeleted = (
    await app.db
      .delete(otpChallenges)
      .where(lte(otpChallenges.expiresAt, daysAgo(RETENTION_POLICY.expiredOtpChallengeDays)))
      .returning({ id: otpChallenges.id })
  ).length;
  const sessionsDeleted = await deleteOldSessions(app, daysAgo(RETENTION_POLICY.expiredSessionDays));
  const abandonedOwnersDeleted = await deleteAbandonedOwners(app, abandonedBefore);

  const report: RetentionReport = {
    rawDocumentsDeleted,
    conversationsDeleted,
    applicationsErased,
    abandonedQuotesDeleted,
    abandonedOwnersDeleted,
    sessionsDeleted,
    otpChallengesDeleted,
    idempotencyKeysDeleted,
  };
  await recordAudit(app, {
    actorRef: 'system',
    action: 'RETENTION_RUN',
    objectType: 'retention',
    requestId: requestId ?? null,
    metadata: report,
  });
  app.logger.info('retention.completed', { job: 'retention', count: rawDocumentsDeleted + applicationsErased });
  return report;
}

/**
 * In-process, which is enough for one long-running server. It also runs at startup, because a server
 * restarted within a day would otherwise never reach its first run. A failed run waits for the next.
 */
export function startRetentionSchedule(app: AppContext, intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  const run = () => {
    runRetention(app).catch((error: unknown) => {
      app.logger.error('retention.failed', { job: 'retention', error });
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  // Mustn't be what keeps the process alive at shutdown.
  timer.unref?.();
  return () => clearInterval(timer);
}

async function deleteExpiredRawDocuments(app: AppContext, verifiedBefore: string): Promise<number> {
  const rows = await app.db
    .select({ document: kycDocuments, application: kycApplications })
    .from(kycDocuments)
    .innerJoin(kycApplications, eq(kycApplications.id, kycDocuments.applicationId))
    .where(isNotNull(kycDocuments.storageKey));

  let deleted = 0;
  for (const { document, application } of rows) {
    const closed = application.status !== 'OPEN' || application.verdict === 'REJECTED' || document.supersededAt !== null;
    // An application that never reached a verdict ages from its last activity.
    const aged = (application.verifiedAt ?? application.updatedAt) <= verifiedBefore;
    if ((closed || aged) && document.storageKey) {
      await deleteDocumentFile(app, document.id, document.storageKey);
      deleted += 1;
    }
  }
  return deleted;
}

function addMonths(isoDate: string, months: number): string {
  const date = new Date(isoDate);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

async function eraseExpiredApplications(app: AppContext, now: Date, abandonedBefore: string): Promise<number> {
  const applications = await app.db.select().from(kycApplications).where(ne(kycApplications.status, 'ERASED'));
  const nowIso = now.toISOString();
  let erased = 0;

  for (const application of applications) {
    const linked = await app.db.select().from(orders).where(eq(orders.kycApplicationId, application.id));
    const live = linked.find((order) => order.status !== 'CANCELLED');

    const contractOver = live?.activatedAt ? addMonths(live.activatedAt, live.contractMonths) <= nowIso : false;
    // An order placed but never activated doesn't justify keeping KYC fields for ever.
    const stalled = live && !live.activatedAt && live.updatedAt <= abandonedBefore;
    const abandoned = (!live && application.updatedAt <= abandonedBefore) || Boolean(stalled);
    if (!contractOver && !abandoned) continue;

    if (stalled) await app.db.update(orders).set({ status: 'CANCELLED', updatedAt: nowIso }).where(eq(orders.id, live.id));
    await eraseApplication(app, application);
    erased += 1;
    if (application.status === 'WITHDRAWN') await recordWithdrawnErasure(app, application.ownerId);
    // With no order pointing at it, even the tombstone has no purpose left.
    if (linked.length === 0) await app.db.delete(kycApplications).where(eq(kycApplications.id, application.id));
  }
  return erased;
}

/** Closes the consent lifecycle for an owner who withdrew while their contract still needed the fields. */
async function recordWithdrawnErasure(app: AppContext, ownerId: string): Promise<void> {
  const [owner] = await app.db.select({ subjectRef: owners.subjectRef }).from(owners).where(eq(owners.id, ownerId)).limit(1);
  if (owner) await appendErased(app, owner.subjectRef, 'kyc_verification');
}

async function deleteAbandonedQuotes(app: AppContext, abandonedBefore: string): Promise<number> {
  const inUse = app.db.select({ id: orders.quoteId }).from(orders);
  const underKyc = app.db
    .select({ id: kycApplications.quoteId })
    .from(kycApplications)
    .where(ne(kycApplications.status, 'ERASED'));
  const deleted = await app.db
    .delete(quotes)
    .where(and(lte(quotes.updatedAt, abandonedBefore), notInArray(quotes.id, inUse), notInArray(quotes.id, underKyc)))
    .returning({ id: quotes.id });
  return deleted.length;
}

async function deleteOldSessions(app: AppContext, before: string): Promise<number> {
  const deleted = await app.db
    .delete(sessions)
    .where(or(lte(sessions.expiresAt, before), lte(sessions.endedAt, before)))
    .returning({ id: sessions.id });
  return deleted.length;
}

async function deleteAbandonedOwners(app: AppContext, abandonedBefore: string): Promise<number> {
  const stillHeld = [
    app.db.select({ id: sessions.ownerId }).from(sessions),
    app.db.select({ id: quotes.ownerId }).from(quotes),
    app.db.select({ id: orders.ownerId }).from(orders),
    app.db.select({ id: kycApplications.ownerId }).from(kycApplications),
    app.db.select({ id: conversations.ownerId }).from(conversations),
    app.db.select({ id: idempotencyKeys.ownerId }).from(idempotencyKeys),
  ].map((query) => notInArray(owners.id, query));

  // Merged owners first, because they point at the owner they merged into.
  const merged = await app.db
    .delete(owners)
    .where(and(eq(owners.status, 'MERGED'), lte(owners.updatedAt, abandonedBefore), ...stillHeld))
    .returning({ id: owners.id });

  const pointedAt = app.db.select({ id: owners.mergedIntoOwnerId }).from(owners).where(isNotNull(owners.mergedIntoOwnerId));
  const others = await app.db
    .delete(owners)
    .where(and(lte(owners.updatedAt, abandonedBefore), notInArray(owners.id, pointedAt), ...stillHeld))
    .returning({ id: owners.id });

  return merged.length + others.length;
}
