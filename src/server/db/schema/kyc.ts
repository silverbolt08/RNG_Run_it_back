import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestamps } from './columns';
import {
  CONTACT_NAME_SOURCES,
  DOCUMENT_QUALITIES,
  DOCUMENT_TYPES,
  enumCheck,
  KYC_APPLICATION_STATUSES,
  KYC_CHECK_IDS,
  KYC_FAIL_ACTIONS,
  KYC_OUTCOMES,
  KYC_SEVERITIES,
  KYC_VERDICTS,
} from './enums';
import { owners } from './identity';

// KYC tables stay separate from analytics, with no shared join for marketing. Names, identifiers
// and extracted fields are held only in `sealed_*` columns, encrypted under the same master key
// as the document files, so a copy of the database file reveals none of them.

export const kycApplications = sqliteTable(
  'kyc_applications',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    // No foreign key: this table must not depend on commerce tables, and erasure deletes rows here first.
    quoteId: text('quote_id').notNull(),
    status: text('status').notNull(),
    verdict: text('verdict'),
    /** Frozen at acceptance, so a verdict is about the bundle the owner agreed to. */
    bundleNeedsGstin: integer('bundle_needs_gstin').notNull(),
    gstinConfirmed: integer('gstin_confirmed').notNull(),
    contactNameSource: text('contact_name_source'),
    /** Encrypted JSON: contact name, business name, GSTIN and Udyam number. */
    sealedIdentity: text('sealed_identity'),
    /** JSON of what KYC changed in the quote. Product and money facts only. */
    quoteChange: text('quote_change'),
    assessedAt: text('assessed_at'),
    verifiedAt: text('verified_at'),
    erasedAt: text('erased_at'),
    ...timestamps(),
  },
  (table) => [
    index('kyc_applications_owner_index').on(table.ownerId, table.id),
    index('kyc_applications_quote_index').on(table.quoteId),
    enumCheck('kyc_applications_status_check', table.status, KYC_APPLICATION_STATUSES),
    enumCheck('kyc_applications_contact_source_check', table.contactNameSource, CONTACT_NAME_SOURCES),
    enumCheck('kyc_applications_verdict_check', table.verdict, KYC_VERDICTS),
    check('kyc_applications_flags_check', sql`${table.bundleNeedsGstin} IN (0, 1) AND ${table.gstinConfirmed} IN (0, 1)`),
  ],
);

export const kycDocuments = sqliteTable(
  'kyc_documents',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => kycApplications.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull(),
    quality: text('quality').notNull(),
    detectedType: text('detected_type'),
    /** Encrypted JSON of the fields parsed from the document. Raw OCR text is never stored. */
    sealedFields: text('sealed_fields'),
    /** The random name of the encrypted file, or null if none was kept or it has been deleted. */
    storageKey: text('storage_key'),
    ocrConfidence: real('ocr_confidence'),
    blurScore: real('blur_score'),
    rotationDegrees: real('rotation_degrees'),
    supersededAt: text('superseded_at'),
    fileDeletedAt: text('file_deleted_at'),
    ...timestamps(),
  },
  (table) => [
    index('kyc_documents_application_index').on(table.applicationId, table.documentType),
    enumCheck('kyc_documents_type_check', table.documentType, DOCUMENT_TYPES),
    enumCheck('kyc_documents_detected_type_check', table.detectedType, DOCUMENT_TYPES),
    enumCheck('kyc_documents_quality_check', table.quality, DOCUMENT_QUALITIES),
  ],
);

export const kycChecks = sqliteTable(
  'kyc_checks',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => kycApplications.id, { onDelete: 'cascade' }),
    checkId: text('check_id').notNull(),
    severity: text('severity').notNull(),
    outcome: text('outcome').notNull(),
    onFail: text('on_fail').notNull(),
    /** Encrypted JSON, because evidence can quote a name or number from the owner's document. */
    sealedEvidence: text('sealed_evidence').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('kyc_checks_application_index').on(table.applicationId),
    enumCheck('kyc_checks_check_id_check', table.checkId, KYC_CHECK_IDS),
    enumCheck('kyc_checks_severity_check', table.severity, KYC_SEVERITIES),
    enumCheck('kyc_checks_outcome_check', table.outcome, KYC_OUTCOMES),
    enumCheck('kyc_checks_on_fail_check', table.onFail, KYC_FAIL_ACTIONS),
  ],
);
