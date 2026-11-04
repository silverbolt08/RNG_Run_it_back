import { and, desc, eq, sql } from 'drizzle-orm';
import { newPublicId } from '../../lib/ids';
import type { AppContext } from '../app-context';
import { recordAudit } from '../db/repositories/audit-repository';
import { consents } from '../db/schema';
import {
  CONSENT_PURPOSES,
  type ConsentChannel,
  type ConsentPurpose,
  type ConsentStatus,
} from '../db/schema/enums';
import { ApiError } from '../http/errors';
import { CURRENT_NOTICE_VERSIONS } from './notices';

export type ConsentState = {
  purpose: ConsentPurpose;
  /** NOT_ASKED and NOTICE_CHANGED are worked out here. Neither is ever stored. */
  status: ConsentStatus | 'NOT_ASKED' | 'NOTICE_CHANGED';
  currentNoticeVersion: string;
  noticeVersion: string | null;
  language: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
};

type ConsentRow = typeof consents.$inferSelect;

async function latestRow(app: AppContext, subjectRef: string, purpose: ConsentPurpose): Promise<ConsentRow | null> {
  // By insertion order, since two rows can share a timestamp when a withdrawal erases at once.
  const [row] = await app.db
    .select()
    .from(consents)
    .where(and(eq(consents.subjectRef, subjectRef), eq(consents.purposeId, purpose)))
    .orderBy(desc(sql`rowid`))
    .limit(1);
  return row ?? null;
}

function isActive(row: ConsentRow | null, purpose: ConsentPurpose): boolean {
  return row?.status === 'GRANTED' && row.noticeVersion === CURRENT_NOTICE_VERSIONS[purpose];
}

/** The server's consent check. Only a grant of the current notice counts. */
export async function hasActiveConsent(app: AppContext, subjectRef: string, purpose: ConsentPurpose): Promise<boolean> {
  return isActive(await latestRow(app, subjectRef, purpose), purpose);
}

function toState(purpose: ConsentPurpose, row: ConsentRow | null): ConsentState {
  const currentNoticeVersion = CURRENT_NOTICE_VERSIONS[purpose];
  let status: ConsentState['status'] = row ? (row.status as ConsentStatus) : 'NOT_ASKED';
  if (row?.status === 'GRANTED' && !isActive(row, purpose)) status = 'NOTICE_CHANGED';

  return {
    purpose,
    status,
    currentNoticeVersion,
    noticeVersion: row?.noticeVersion ?? null,
    language: row?.language ?? null,
    grantedAt: row?.grantedAt ?? null,
    withdrawnAt: row?.withdrawnAt ?? null,
  };
}

export async function listConsents(app: AppContext, subjectRef: string): Promise<ConsentState[]> {
  return Promise.all(CONSENT_PURPOSES.map(async (purpose) => toState(purpose, await latestRow(app, subjectRef, purpose))));
}

export async function grantConsent(
  app: AppContext,
  subjectRef: string,
  input: { purpose: ConsentPurpose; noticeVersion: string; language: string },
  requestId: string,
): Promise<ConsentState> {
  if (input.noticeVersion !== CURRENT_NOTICE_VERSIONS[input.purpose]) {
    throw new ApiError(409, 'NOTICE_OUTDATED', 'This notice has changed. Please read the latest one.', {
      currentNoticeVersion: CURRENT_NOTICE_VERSIONS[input.purpose],
    });
  }
  const row = await appendConsent(app, subjectRef, input.purpose, 'GRANTED', {
    noticeVersion: input.noticeVersion,
    language: input.language,
  });
  await recordAudit(app, {
    actorRef: subjectRef,
    action: 'CONSENT_GRANTED',
    objectType: 'consent',
    objectId: row.id,
    requestId,
    metadata: { purpose: input.purpose, noticeVersion: input.noticeVersion },
  });
  return toState(input.purpose, row);
}

/** Records the withdrawal. What it stops or erases is decided by withdrawal-service. */
export async function appendWithdrawal(
  app: AppContext,
  subjectRef: string,
  purpose: ConsentPurpose,
  requestId: string,
): Promise<ConsentState> {
  const latest = await latestRow(app, subjectRef, purpose);
  if (latest?.status !== 'GRANTED') {
    throw new ApiError(409, 'CONSENT_NOT_ACTIVE', 'There is no active consent to withdraw.');
  }
  const row = await appendConsent(app, subjectRef, purpose, 'WITHDRAWN', {
    noticeVersion: latest.noticeVersion,
    language: latest.language,
    grantedAt: latest.grantedAt,
    withdrawnAt: app.clock.now().toISOString(),
  });
  await recordAudit(app, {
    actorRef: subjectRef,
    action: 'CONSENT_WITHDRAWN',
    objectType: 'consent',
    objectId: row.id,
    requestId,
    metadata: { purpose },
  });
  return toState(purpose, row);
}

/** Appends the end of the lifecycle once erasure has finished. */
export async function appendErased(app: AppContext, subjectRef: string, purpose: ConsentPurpose): Promise<void> {
  const latest = await latestRow(app, subjectRef, purpose);
  if (!latest) return;
  await appendConsent(app, subjectRef, purpose, 'ERASED', {
    noticeVersion: latest.noticeVersion,
    language: latest.language,
    grantedAt: latest.grantedAt,
    withdrawnAt: latest.withdrawnAt,
  });
}

/** A returning owner keeps what they agreed to while anonymous, recorded under their own reference. */
export async function copyActiveConsents(app: AppContext, fromSubject: string, toSubject: string): Promise<void> {
  for (const purpose of CONSENT_PURPOSES) {
    const source = await latestRow(app, fromSubject, purpose);
    if (!isActive(source, purpose) || !source) continue;
    if (isActive(await latestRow(app, toSubject, purpose), purpose)) continue;
    await appendConsent(
      app,
      toSubject,
      purpose,
      'GRANTED',
      { noticeVersion: source.noticeVersion, language: source.language, grantedAt: source.grantedAt },
      'SESSION_MERGE',
    );
  }
}

async function appendConsent(
  app: AppContext,
  subjectRef: string,
  purpose: ConsentPurpose,
  status: ConsentStatus,
  values: { noticeVersion: string; language: string; grantedAt?: string | null; withdrawnAt?: string | null },
  channel: ConsentChannel = 'WEB',
): Promise<ConsentRow> {
  const now = app.clock.now().toISOString();
  const row: ConsentRow = {
    id: newPublicId('con'),
    subjectRef,
    purposeId: purpose,
    noticeVersion: values.noticeVersion,
    language: values.language,
    status,
    grantedAt: values.grantedAt === undefined ? now : values.grantedAt,
    withdrawnAt: values.withdrawnAt ?? null,
    channel,
    createdAt: now,
    updatedAt: now,
  };
  await app.db.insert(consents).values(row);
  return row;
}
