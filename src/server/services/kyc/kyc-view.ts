import type { KycCheckId, KycVerdict } from '../../../domain/kyc/assess-kyc';
import type { DocumentType } from '../../../domain/kyc/documents';
import { maskGstin, maskUdyam } from '../../../lib/mask';
import type { AppContext } from '../../app-context';
import { documentsNeeded } from './kyc-assessment';
import {
  evidenceContext,
  listActiveDocuments,
  listChecks,
  readIdentity,
  type ApplicationRow,
  type CheckRow,
  type DocumentRow,
} from './kyc-repository';

// How long to wait before re-running verification during a registry outage.
const PENDING_RETRY_SECONDS = 60;

export type NextAction =
  | 'PROVIDE_CONTACT_NAME'
  | 'UPLOAD_DOCUMENTS'
  | 'RETAKE_DOCUMENT'
  | 'CONFIRM_GSTIN'
  | 'ACCEPT_NEW_QUOTE'
  | 'RETRY_VERIFICATION'
  | 'PLACE_ORDER';

export type DocumentView = {
  id: string;
  documentType: string;
  quality: string;
  detectedType: string | null;
  ocrConfidence: number | null;
  uploadedAt: string;
};

export type CheckView = {
  id: KycCheckId;
  severity: string;
  outcome: string;
  onFail: string;
  evidence: Record<string, string>;
};

export type GstinConfirmation = { read: string | null; suggestion: string | null };

export type KycApplicationView = {
  id: string;
  quoteId: string;
  status: string;
  verdict: KycVerdict | null;
  contact: { name: string | null; source: string | null };
  requiredDocuments: DocumentType[];
  missingDocuments: DocumentType[];
  documents: DocumentView[];
  gstin: { masked: string | null; confirmedByOwner: boolean; confirmation: GstinConfirmation | null };
  checks: CheckView[];
  quoteChange: unknown;
  nextActions: NextAction[];
  retryAfterSeconds: number | null;
  assessedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const toDocumentView = (document: DocumentRow): DocumentView => ({
  id: document.id,
  documentType: document.documentType,
  quality: document.quality,
  detectedType: document.detectedType,
  ocrConfidence: document.ocrConfidence,
  uploadedAt: document.createdAt,
});

const asksOwnerToConfirm = (check: CheckRow) => check.outcome === 'FAIL' && check.onFail === 'NEEDS_CONFIRMATION';

/**
 * Identifiers are masked, except what the owner must see in full to check it against their own
 * certificate. Names in evidence come only from the owner's documents, never from a registry.
 */
function toCheckView(app: AppContext, check: CheckRow): CheckView {
  const raw = app.sealer.openJson<Record<string, string>>(check.sealedEvidence, evidenceContext(check.id));
  const showFull = asksOwnerToConfirm(check) && check.checkId.startsWith('GST_');
  const mask = check.checkId.startsWith('UDYAM') ? maskUdyam : maskGstin;

  const evidence = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const isIdentifier = key === 'read' || key === 'suggestion';
      return [key, isIdentifier && !showFull ? mask(value) : value];
    }),
  );
  return { id: check.checkId as KycCheckId, severity: check.severity, outcome: check.outcome, onFail: check.onFail, evidence };
}

function findConfirmation(checks: readonly CheckView[]): GstinConfirmation | null {
  const check = checks.find(
    (item) =>
      (item.id === 'GST_FORMAT' || item.id === 'GST_FOUND') && item.outcome === 'FAIL' && item.onFail === 'NEEDS_CONFIRMATION',
  );
  if (!check) return null;
  return { read: check.evidence.read ?? null, suggestion: check.evidence.suggestion ?? null };
}

export async function toApplicationView(app: AppContext, row: ApplicationRow): Promise<KycApplicationView> {
  const identity = readIdentity(app.sealer, row);
  const documents = await listActiveDocuments(app, row.id);
  const checks = (await listChecks(app, row.id)).map((check) => toCheckView(app, check));
  const uploaded = new Set(documents.map((doc) => doc.documentType));
  const required = row.status === 'OPEN' ? documentsNeeded(row, identity, documents) : [];
  const missing = required.filter((type) => !uploaded.has(type));
  const confirmation = findConfirmation(checks);
  const quoteChange: unknown = row.quoteChange ? JSON.parse(row.quoteChange) : null;
  const verdict = row.verdict as KycVerdict | null;

  return {
    id: row.id,
    quoteId: row.quoteId,
    status: row.status,
    verdict,
    contact: { name: identity.contactName, source: row.contactNameSource },
    requiredDocuments: required,
    missingDocuments: missing,
    documents: documents.map(toDocumentView),
    gstin: {
      masked: identity.gstin ? maskGstin(identity.gstin) : null,
      confirmedByOwner: row.gstinConfirmed === 1,
      confirmation,
    },
    checks,
    quoteChange,
    nextActions: row.status === 'OPEN' ? nextActionsFor(identity.contactName, missing, documents, checks, confirmation, quoteChange, verdict) : [],
    retryAfterSeconds: verdict === 'VERIFICATION_PENDING' ? PENDING_RETRY_SECONDS : null,
    assessedAt: row.assessedAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nextActionsFor(
  contactName: string | null,
  missing: readonly DocumentType[],
  documents: readonly DocumentRow[],
  checks: readonly CheckView[],
  confirmation: GstinConfirmation | null,
  quoteChange: unknown,
  verdict: KycVerdict | null,
): NextAction[] {
  const actions: NextAction[] = [];
  if (contactName === null) actions.push('PROVIDE_CONTACT_NAME');
  if (missing.length > 0) actions.push('UPLOAD_DOCUMENTS');

  const needsRetake =
    documents.some((doc) => doc.quality !== 'OK') ||
    checks.some((check) => check.outcome === 'FAIL' && check.onFail === 'RETAKE' && check.evidence.problem !== 'MISSING');
  if (needsRetake) actions.push('RETAKE_DOCUMENT');

  if (confirmation) actions.push('CONFIRM_GSTIN');
  if (quoteChange) actions.push('ACCEPT_NEW_QUOTE');
  if (verdict === 'VERIFICATION_PENDING') actions.push('RETRY_VERIFICATION');
  if ((verdict === 'VERIFIED' || verdict === 'MANUAL_REVIEW') && !quoteChange) actions.push('PLACE_ORDER');
  return actions;
}
