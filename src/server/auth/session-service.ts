import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { newPublicId } from '../../lib/ids';
import { maskPhone } from '../../lib/mask';
import type { AppContext } from '../app-context';
import { copyActiveConsents } from '../consent/consent-service';
import { buildAuditRow } from '../db/repositories/audit-repository';
import {
  auditLog,
  conversations,
  idempotencyKeys,
  kycApplications,
  notifications,
  orders,
  otpChallenges,
  owners,
  quotes,
  sessions,
} from '../db/schema';
import { ApiError, notFound } from '../http/errors';
import { signToken, verifySignedToken } from './session-cookie';

export type SessionInfo = {
  sessionId: string;
  ownerId: string;
  subjectRef: string;
  phoneVerified: boolean;
  phoneLast4: string | null;
  expiresAt: string;
};

export type StartedSession = { info: SessionInfo; cookieValue: string; maxAgeSeconds: number };

// Long enough to come back to a saved quote, which the blueprint asks for.
const SESSION_DAYS = 30;
const OTP_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000).toISOString();

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Keyed, so a copy of the database can't be reversed by hashing every possible phone number. */
const keyedHash = (app: AppContext, label: string, value: string) =>
  createHmac('sha256', app.config.sessionSecret).update(`${label}:${value}`).digest('hex');

export const toPublicSession = (session: SessionInfo) => ({
  phoneVerified: session.phoneVerified,
  phoneMasked: session.phoneLast4 ? maskPhone(`000000${session.phoneLast4}`) : null,
  expiresAt: session.expiresAt,
});

export async function startAnonymousSession(app: AppContext): Promise<StartedSession> {
  const now = app.clock.now().toISOString();
  const ownerId = newPublicId('own');
  const subjectRef = newPublicId('sub');
  await app.db.insert(owners).values({ id: ownerId, subjectRef, status: 'ANONYMOUS', createdAt: now, updatedAt: now });
  return createSessionFor(app, { ownerId, subjectRef, phoneVerified: false, phoneLast4: null });
}

export async function resolveSession(app: AppContext, cookieValue: string): Promise<SessionInfo | null> {
  const token = verifySignedToken(cookieValue, app.config.sessionSecret);
  if (!token) return null;

  const now = app.clock.now().toISOString();
  const [row] = await app.db
    .select({ session: sessions, owner: owners })
    .from(sessions)
    .innerJoin(owners, eq(owners.id, sessions.ownerId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.endedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;

  return {
    sessionId: row.session.id,
    ownerId: row.owner.id,
    subjectRef: row.owner.subjectRef,
    phoneVerified: row.owner.status === 'VERIFIED',
    phoneLast4: row.owner.phoneLast4,
    expiresAt: row.session.expiresAt,
  };
}

export async function endSession(app: AppContext, session: SessionInfo): Promise<void> {
  const now = app.clock.now().toISOString();
  await app.db.update(sessions).set({ endedAt: now, updatedAt: now }).where(eq(sessions.id, session.sessionId));
}

export type OtpChallenge = {
  challengeId: string;
  expiresAt: string;
  phoneMasked: string;
  delivery: 'MOCK_NO_SMS_SENT';
  testCode: string;
};

/** Mock OTP: nothing is sent, and the response labels the fixed test code for the demo. */
export async function requestOtp(app: AppContext, session: SessionInfo, phone: string): Promise<OtpChallenge> {
  const now = app.clock.now();
  const challengeId = newPublicId('otp');
  const expiresAt = addMinutes(now, OTP_MINUTES);
  const last4 = phone.slice(-4);

  await app.db.insert(otpChallenges).values({
    id: challengeId,
    sessionId: session.sessionId,
    phoneHash: keyedHash(app, 'phone', phone),
    phoneLast4: last4,
    codeHash: keyedHash(app, `otp:${challengeId}`, app.config.otpTestCode),
    attempts: 0,
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  return {
    challengeId,
    expiresAt,
    phoneMasked: maskPhone(phone),
    delivery: 'MOCK_NO_SMS_SENT',
    testCode: app.config.otpTestCode,
  };
}

export async function verifyOtp(
  app: AppContext,
  session: SessionInfo,
  challengeId: string,
  code: string,
  requestId: string,
): Promise<StartedSession> {
  const now = app.clock.now().toISOString();
  const [challenge] = await app.db
    .select()
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.id, challengeId),
        eq(otpChallenges.sessionId, session.sessionId),
        isNull(otpChallenges.consumedAt),
      ),
    )
    .limit(1);
  if (!challenge) throw notFound();
  if (challenge.expiresAt <= now) throw new ApiError(422, 'OTP_EXPIRED', 'This code has expired. Please ask for a new one.');
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many wrong codes. Please ask for a new one.');
  }

  const expected = Buffer.from(challenge.codeHash);
  const supplied = Buffer.from(keyedHash(app, `otp:${challengeId}`, code));
  if (!timingSafeEqual(expected, supplied)) {
    await app.db
      .update(otpChallenges)
      .set({ attempts: challenge.attempts + 1, updatedAt: now })
      .where(eq(otpChallenges.id, challengeId));
    throw new ApiError(422, 'OTP_INCORRECT', 'That code is not right. Please check it and try again.');
  }

  const owner = await upgradeOwner(app, session, challenge.phoneHash, challenge.phoneLast4, requestId);
  await app.db.update(otpChallenges).set({ consumedAt: now, updatedAt: now }).where(eq(otpChallenges.id, challengeId));

  // A new token after sign-in, so a token seen before it can't be used to ride this session.
  await app.db.update(sessions).set({ endedAt: now, updatedAt: now }).where(eq(sessions.id, session.sessionId));
  return createSessionFor(app, {
    ownerId: owner.id,
    subjectRef: owner.subjectRef,
    phoneVerified: true,
    phoneLast4: challenge.phoneLast4,
  });
}

async function createSessionFor(
  app: AppContext,
  owner: { ownerId: string; subjectRef: string; phoneVerified: boolean; phoneLast4: string | null },
): Promise<StartedSession> {
  const now = app.clock.now();
  const token = randomBytes(32).toString('base64url');
  const sessionId = newPublicId('ses');
  const maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60;
  const expiresAt = new Date(now.getTime() + maxAgeSeconds * 1000).toISOString();

  await app.db.insert(sessions).values({
    id: sessionId,
    ownerId: owner.ownerId,
    tokenHash: sha256(token),
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  return {
    info: { sessionId, expiresAt, ...owner },
    cookieValue: signToken(token, app.config.sessionSecret),
    maxAgeSeconds,
  };
}

/** Marks this owner verified, or moves their work to the owner who already holds this phone. */
async function upgradeOwner(
  app: AppContext,
  session: SessionInfo,
  phoneHash: string,
  phoneLast4: string,
  requestId: string,
): Promise<{ id: string; subjectRef: string }> {
  const now = app.clock.now().toISOString();
  const [existing] = await app.db.select().from(owners).where(eq(owners.phoneHash, phoneHash)).limit(1);

  if (existing && existing.id !== session.ownerId) {
    await mergeOwners(app, session, existing, now, requestId);
    return existing;
  }

  await app.db.batch([
    app.db
      .update(owners)
      .set({ status: 'VERIFIED', phoneHash, phoneLast4, phoneVerifiedAt: now, updatedAt: now })
      .where(eq(owners.id, session.ownerId)),
    app.db.insert(auditLog).values(
      buildAuditRow(app.clock, {
        actorRef: session.subjectRef,
        action: 'PHONE_VERIFIED',
        objectType: 'owner',
        objectId: session.subjectRef,
        requestId,
      }),
    ),
  ]);
  return { id: session.ownerId, subjectRef: session.subjectRef };
}

async function mergeOwners(
  app: AppContext,
  session: SessionInfo,
  target: { id: string; subjectRef: string },
  now: string,
  requestId: string,
): Promise<void> {
  const from = session.ownerId;
  const moved = { ownerId: target.id, updatedAt: now };
  await app.db.batch([
    app.db.update(quotes).set(moved).where(eq(quotes.ownerId, from)),
    app.db.update(orders).set(moved).where(eq(orders.ownerId, from)),
    app.db.update(kycApplications).set(moved).where(eq(kycApplications.ownerId, from)),
    app.db.update(conversations).set(moved).where(eq(conversations.ownerId, from)),
    app.db.update(notifications).set(moved).where(eq(notifications.ownerId, from)),
    app.db.update(idempotencyKeys).set(moved).where(eq(idempotencyKeys.ownerId, from)),
    app.db
      .update(owners)
      .set({ status: 'MERGED', mergedIntoOwnerId: target.id, updatedAt: now })
      .where(eq(owners.id, from)),
    app.db.insert(auditLog).values(
      buildAuditRow(app.clock, {
        actorRef: target.subjectRef,
        action: 'OWNER_MERGED',
        objectType: 'owner',
        objectId: session.subjectRef,
        requestId,
      }),
    ),
  ]);
  await copyActiveConsents(app, session.subjectRef, target.subjectRef);
}
