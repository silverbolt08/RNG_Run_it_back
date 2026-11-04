import { sql } from 'drizzle-orm';
import { check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { DELAY_REASONS, ORDER_STAGES, ORDER_STATUSES, PAYMENT_STATUSES } from '../../../domain/orders/orders';

// Enums are text columns with check constraints, per CLAUDE.md. Drizzle-kit reads this file
// directly, so imports here stay relative.

export const CONSENT_PURPOSES = ['advisor_profile', 'kyc_verification', 'service_updates', 'marketing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_STATUSES = ['GRANTED', 'DECLINED', 'WITHDRAWN', 'ERASURE_PENDING', 'ERASED', 'EXPIRED'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_CHANNELS = ['WEB', 'SESSION_MERGE'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const OWNER_STATUSES = ['ANONYMOUS', 'VERIFIED', 'MERGED'] as const;

export const GSTIN_STATUSES = ['ACTIVE', 'CANCELLED', 'SUSPENDED', 'NONE', 'UNKNOWN'] as const;
export const REGISTRY_GST_STATUSES = ['Active', 'Cancelled', 'Suspended'] as const;

export const QUOTE_STATUSES = ['DRAFT', 'SAVED', 'ACCEPTED', 'NEEDS_ACCEPTANCE'] as const;

export const KYC_APPLICATION_STATUSES = ['OPEN', 'WITHDRAWN', 'ERASED'] as const;

export const KYC_VERDICTS = [
  'VERIFIED',
  'RETAKE',
  'NEEDS_CONFIRMATION',
  'VERIFICATION_PENDING',
  'MANUAL_REVIEW',
  'REJECTED',
] as const;

export const CONTACT_NAME_SOURCES = ['OWNER', 'LEAD_PREFILL'] as const;

export const DOCUMENT_TYPES = ['GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF'] as const;

export const DOCUMENT_QUALITIES = ['OK', 'BLURRED', 'UNREADABLE', 'WRONG_TYPE'] as const;

export const KYC_CHECK_IDS = [
  'GST_DOCUMENT',
  'GST_FORMAT',
  'GST_FOUND',
  'GST_STATUS',
  'GST_NAME',
  'GST_ADDRESS',
  'GST_STATE',
  'UDYAM_PRESENT',
  'UDYAM_NAME',
  'UDYAM_DATE',
  'UDYAM_ACTIVITY',
  'ADDRESS_DOCUMENT',
  'ADDRESS_MATCH',
  'ADDRESS_AGE',
  'BILL_NAME',
  'SIGNATORY_DOCUMENT',
  'SIGNATORY_NAME',
  'SIGNATORY_VALID',
  'SIGNATORY_BUSINESS',
] as const;
export const KYC_SEVERITIES = ['HARD', 'SOFT', 'ADVISORY'] as const;
export const KYC_OUTCOMES = ['PASS', 'FAIL', 'SKIPPED', 'PENDING'] as const;
export const KYC_FAIL_ACTIONS = ['REJECTED', 'RETAKE', 'NEEDS_CONFIRMATION', 'MANUAL_REVIEW', 'NONE'] as const;

export { DELAY_REASONS, ORDER_STAGES, ORDER_STATUSES, PAYMENT_STATUSES };

export const ORDER_EVENT_TYPES = [
  'ORDER_PLACED',
  'STAGE_ADVANCED',
  'DELAY_MARKED',
  'PAYMENT_FAILED',
  'PAYMENT_CONFIRMED',
  'ORDER_CANCELLED',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const PAYMENT_OUTCOMES = ['SUCCESS', 'FAILED'] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export const IDEMPOTENCY_SCOPES = ['ORDER', 'DOCUMENT_UPLOAD'] as const;
export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[number];

export const CONVERSATION_STATUSES = ['OPEN', 'CLOSED', 'HANDED_OFF'] as const;

export const SIMULATION_FLAGS = ['REGISTRY_OUTAGE'] as const;
export type SimulationFlag = (typeof SIMULATION_FLAGS)[number];

export function enumCheck(name: string, column: AnySQLiteColumn, values: readonly string[]) {
  const list = values.map((value) => `'${value}'`).join(', ');
  return check(name, sql`${column} IN (${sql.raw(list)})`);
}
