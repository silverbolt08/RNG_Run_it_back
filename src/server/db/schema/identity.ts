import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { timestamps } from './columns';
import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_STATUSES,
  enumCheck,
  OWNER_STATUSES,
} from './enums';

/**
 * Added for auth: everything an owner does needs an owner to belong to, from the first visit.
 * An anonymous owner holds no personal data. Once verified, only a keyed hash of the phone and
 * its last 4 digits are kept: the hash finds a returning owner and the digits mask it on screen.
 * Nothing in the prototype sends a real message, so the full number has no purpose here.
 */
export const owners = sqliteTable(
  'owners',
  {
    id: text('id').primaryKey(),
    /** The pseudonym for logs, consents and audit, so none of them needs a personal value. */
    subjectRef: text('subject_ref').notNull().unique(),
    status: text('status').notNull(),
    phoneHash: text('phone_hash').unique(),
    phoneLast4: text('phone_last4'),
    phoneVerifiedAt: text('phone_verified_at'),
    mergedIntoOwnerId: text('merged_into_owner_id').references((): AnySQLiteColumn => owners.id),
    ...timestamps(),
  },
  (table) => [enumCheck('owners_status_check', table.status, OWNER_STATUSES)],
);

/**
 * Added for auth: a server-side session behind the signed cookie, so ending a session really
 * ends it. Only a hash of the token is stored, so a database leak can't be replayed as a login.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    endedAt: text('ended_at'),
    ...timestamps(),
  },
  (table) => [index('sessions_owner_index').on(table.ownerId)],
);

/** Added for auth: one row per OTP request, so codes can expire and attempts can be capped. */
export const otpChallenges = sqliteTable(
  'otp_challenges',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    phoneHash: text('phone_hash').notNull(),
    phoneLast4: text('phone_last4').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    ...timestamps(),
  },
  (table) => [check('otp_challenges_attempts_check', sql`${table.attempts} >= 0`)],
);

/**
 * Append-only, enforced by triggers in the migrations. Withdrawal adds a row rather than editing
 * one. `subject_ref` isn't a foreign key, because proof of consent must outlive the owner's data.
 */
export const consents = sqliteTable(
  'consents',
  {
    id: text('id').primaryKey(),
    subjectRef: text('subject_ref').notNull(),
    purposeId: text('purpose_id').notNull(),
    noticeVersion: text('notice_version').notNull(),
    language: text('language').notNull(),
    status: text('status').notNull(),
    grantedAt: text('granted_at'),
    withdrawnAt: text('withdrawn_at'),
    channel: text('channel').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('consents_subject_purpose_index').on(table.subjectRef, table.purposeId),
    enumCheck('consents_purpose_check', table.purposeId, CONSENT_PURPOSES),
    enumCheck('consents_status_check', table.status, CONSENT_STATUSES),
    enumCheck('consents_channel_check', table.channel, CONSENT_CHANNELS),
  ],
);

/**
 * Append-only, enforced by triggers in the migrations. Who, what and when, with no personal
 * values: `metadata` holds counts and codes only.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorRef: text('actor_ref').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    requestId: text('request_id'),
    metadata: text('metadata'),
    ...timestamps(),
  },
  (table) => [index('audit_log_object_index').on(table.objectType, table.objectId)],
);
