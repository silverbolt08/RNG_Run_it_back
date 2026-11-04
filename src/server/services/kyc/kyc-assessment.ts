import { eq } from 'drizzle-orm';
import type { GstinStatus } from '../../../domain/eligibility/eligibility';
import {
  assessKyc,
  prepareGstin,
  requiredDocuments,
  type DocumentSlot,
  type GstFields,
  type GstRecord,
  type KycAssessment,
  type RegistryLookup,
  type UdyamRecord,
  type PreparedGstin,
  type UdyamFields,
} from '../../../domain/kyc/assess-kyc';
import type { AddressProofFields, DocumentType, SignatoryFields } from '../../../domain/kyc/documents';
import { isValidUdyamFormat } from '../../../domain/kyc/udyam';
import { newPublicId } from '../../../lib/ids';
import type { AppContext } from '../../app-context';
import { recordAudit } from '../../db/repositories/audit-repository';
import { kycChecks } from '../../db/schema';
import { applyGstinFinding } from '../quote-service';
import { deleteRawFiles } from './kyc-erasure';
import {
  evidenceContext,
  fieldsContext,
  findLeadByGstin,
  listActiveDocuments,
  readIdentity,
  sealIdentity,
  updateApplication,
  type ApplicationRow,
  type DocumentRow,
  type KycIdentity,
  type LeadMatch,
} from './kyc-repository';

const GSTIN_STATUS_BY_REGISTRY: Readonly<Record<GstRecord['status'], GstinStatus>> = {
  Active: 'ACTIVE',
  Cancelled: 'CANCELLED',
  Suspended: 'SUSPENDED',
};

function toSlot<T>(app: AppContext, document: DocumentRow | undefined): DocumentSlot<T> {
  if (!document) return { quality: 'MISSING' };
  switch (document.quality) {
    case 'OK':
      if (!document.sealedFields) return { quality: 'UNREADABLE' };
      return { quality: 'OK', fields: app.sealer.openJson<T>(document.sealedFields, fieldsContext(document.id)) };
    case 'BLURRED':
      return { quality: 'BLURRED' };
    case 'WRONG_TYPE':
      return { quality: 'WRONG_TYPE', detected: document.detectedType as DocumentType | null };
    // Kept during an OCR outage. Nothing has been read from it yet, so nothing can be checked.
    case 'PENDING_READ':
      return { quality: 'MISSING' };
    default:
      return { quality: 'UNREADABLE' };
  }
}

/** The GSTIN status the registry or the owner's confirmation has established, if any. */
function gstinFinding(
  lookup: RegistryLookup<GstRecord>,
  prepared: PreparedGstin | null,
  confirmed: boolean,
): GstinStatus | null {
  if (lookup.status === 'FOUND') return GSTIN_STATUS_BY_REGISTRY[lookup.record.status];
  // Only once the owner has confirmed the number, since a bad read must not change their quote.
  if (confirmed && lookup.status === 'NOT_FOUND') return 'NONE';
  if (confirmed && prepared && !prepared.readyForLookup) return 'NONE';
  return null;
}

async function lookupUdyam(
  app: AppContext,
  udyam: DocumentSlot<UdyamFields>,
  identity: KycIdentity,
  lead: LeadMatch | null,
): Promise<RegistryLookup<UdyamRecord>> {
  const number = udyam.quality === 'OK' ? udyam.fields.udyamNumber || null : (identity.udyamNumber ?? lead?.udyamNumber ?? null);
  if (!number || !isValidUdyamFormat(number)) return { status: 'NOT_RUN' };
  return app.registry.lookupUdyam(number);
}

export function documentsNeeded(row: ApplicationRow, identity: KycIdentity, documents: readonly DocumentRow[]): DocumentType[] {
  return requiredDocuments({
    bundleNeedsGstin: row.bundleNeedsGstin === 1,
    ownerGaveGstin: identity.gstin !== null || documents.some((doc) => doc.documentType === 'GST_CERTIFICATE'),
  });
}

/**
 * The pipeline after upload: prepare the GSTIN, look up, cross-check, then let the domain give the
 * verdict. Each run records its outcome, so a registry outage or a retake never loses progress.
 */
export async function assessApplication(
  app: AppContext,
  initial: ApplicationRow,
  requestId: string,
): Promise<ApplicationRow> {
  const documents = await listActiveDocuments(app, initial.id);
  const byType = new Map(documents.map((doc) => [doc.documentType, doc]));
  const identity: KycIdentity = { ...readIdentity(app.sealer, initial) };
  const confirmed = initial.gstinConfirmed === 1;

  const gst = toSlot<GstFields>(app, byType.get('GST_CERTIFICATE'));
  // The owner's confirmed number replaces what OCR read, and the domain then judges it as printed.
  if (gst.quality === 'OK' && confirmed && identity.gstin) gst.fields.gstin = identity.gstin;

  const candidate = gst.quality === 'OK' ? gst.fields.gstin : identity.gstin;
  const prepared = candidate ? prepareGstin(candidate) : null;
  const gstLookup: RegistryLookup<GstRecord> = prepared?.readyForLookup
    ? await app.registry.lookupGstin(prepared.value)
    : { status: 'NOT_RUN' };
  if (prepared && prepared.value !== '') identity.gstin = prepared.value;

  const lead = prepared?.readyForLookup ? await findLeadByGstin(app, prepared.value) : null;
  // Only from a matching certificate, because typing a number must not unlock a stranger's name.
  // The view never shows a prefilled name: it is only compared against the signatory's ID.
  const prefilled = identity.contactName === null && lead !== null && gst.quality === 'OK';
  if (prefilled) identity.contactName = lead.contactName;

  const udyam = toSlot<UdyamFields>(app, byType.get('UDYAM_CERTIFICATE'));
  const assessment = assessKyc({
    today: app.clock.today(),
    contactName: identity.contactName,
    businessName: identity.businessName ?? lead?.businessName ?? null,
    bundleNeedsGstin: initial.bundleNeedsGstin === 1,
    gstinConfirmedByOwner: confirmed,
    gst,
    udyam,
    signatory: toSlot<SignatoryFields>(app, byType.get('SIGNATORY_ID')),
    addressProof: toSlot<AddressProofFields>(app, byType.get('ADDRESS_PROOF')),
    gstLookup,
    udyamLookup: await lookupUdyam(app, udyam, identity, lead),
  });

  const needed = documentsNeeded(initial, identity, documents);
  const incomplete = identity.contactName === null || needed.some((type) => !byType.has(type));
  // Until everything is in, a "retake" only means "not uploaded yet". A rejection is final enough to say now.
  const heldForOcr = documents.some((doc) => doc.quality === 'PENDING_READ');
  const verdict = heldForOcr
    ? incomplete
      ? null
      : 'VERIFICATION_PENDING'
    : incomplete && assessment.verdict !== 'REJECTED'
      ? null
      : assessment.verdict;

  const finding = gstinFinding(gstLookup, prepared, confirmed);
  const quoteChange = finding ? await applyGstinFinding(app, initial.ownerId, initial.quoteId, finding) : null;

  await replaceChecks(app, initial.id, assessment);
  const now = app.clock.now().toISOString();
  const updated = await updateApplication(app, initial.id, {
    verdict,
    assessedAt: now,
    verifiedAt: verdict === 'VERIFIED' ? (initial.verifiedAt ?? now) : null,
    sealedIdentity: sealIdentity(app.sealer, initial.id, identity),
    contactNameSource: prefilled ? 'LEAD_PREFILL' : initial.contactNameSource,
    ...(quoteChange ? { quoteChange: JSON.stringify(quoteChange) } : {}),
  });

  // Raw images go at once on rejection. The extracted fields remain, so accepting a changed quote
  // can still re-run the checks without asking the owner to upload again.
  if (verdict === 'REJECTED') await deleteRawFiles(app, initial.id);

  await recordAudit(app, {
    actorRef: 'system',
    action: 'KYC_ASSESSED',
    objectType: 'kyc_application',
    objectId: initial.id,
    requestId,
    metadata: { verdict, documents: documents.length, prefilled },
  });
  app.logger.info('kyc.assessed', { requestId, applicationId: initial.id, verdict });
  return updated;
}

async function replaceChecks(app: AppContext, applicationId: string, assessment: KycAssessment): Promise<void> {
  const now = app.clock.now().toISOString();
  const rows = assessment.checks.map((check) => {
    const id = newPublicId('chk');
    return {
      id,
      applicationId,
      checkId: check.id,
      severity: check.severity,
      outcome: check.outcome,
      onFail: check.onFail,
      sealedEvidence: app.sealer.sealJson(check.evidence, evidenceContext(id)),
      createdAt: now,
      updatedAt: now,
    };
  });
  await app.db.transaction(async (tx) => {
    await tx.delete(kycChecks).where(eq(kycChecks.applicationId, applicationId));
    if (rows.length > 0) await tx.insert(kycChecks).values(rows);
  });
}
