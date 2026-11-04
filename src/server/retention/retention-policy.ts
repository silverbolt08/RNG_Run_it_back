/**
 * Every retention period, in one place. These are the proposed defaults in the privacy-security
 * skill. Change a number here and the job follows, but the privacy note must change with it.
 *
 * Not on this list because nothing deletes them: consent and audit records, kept as long as
 * needed to prove compliance. Extracted KYC fields on an activated order last for the contract
 * term, which comes from the order rather than from a fixed period.
 */
export const RETENTION_POLICY = {
  /** Raw document images, after verification. A rejection or withdrawal deletes them at once. */
  rawDocumentDaysAfterVerification: 30,
  /** Advisor conversations, which have identifiers redacted before they are stored. */
  advisorConversationDays: 90,
  /** A journey that never reached an order: quotes, KYC applications and the owner record. */
  abandonedLeadDays: 180,
  /** Application logs go to stdout, so the host enforces this. The job can't, and doesn't try. */
  applicationLogDays: 30,
  /** How long an ended or expired session stays before it is removed. */
  expiredSessionDays: 7,
  /** OTP challenges past their expiry. */
  expiredOtpChallengeDays: 1,
  /** Long enough for a client to retry after a network drop. */
  idempotencyKeyDays: 7,
} as const;
