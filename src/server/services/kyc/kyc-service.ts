import { getProduct } from '../../../domain/catalogue/catalogue';
import { isPlausibleCorrection } from '../../../domain/kyc/gstin';
import { newPublicId } from '../../../lib/ids';
import type { AppContext } from '../../app-context';
import type { SessionInfo } from '../../auth/session-service';
import { recordAudit } from '../../db/repositories/audit-repository';
import { kycApplications } from '../../db/schema';
import { enforceRateLimit } from '../../http/api-route';
import { ApiError } from '../../http/errors';
import { RATE_LIMITS } from '../../http/rate-limiter';
import { loadQuote } from '../quote-repository';
import { assessApplication } from './kyc-assessment';
import {
  evidenceContext,
  findOpenApplicationForQuote,
  listChecks,
  loadApplication,
  readIdentity,
  sealIdentity,
  updateApplication,
  type ApplicationRow,
  type KycIdentity,
} from './kyc-repository';
import { readPendingDocuments } from './kyc-upload';
import { toApplicationView, type KycApplicationView } from './kyc-view';

export type CreateInput = { quoteId: string; contactName?: string; businessName?: string; gstin?: string; declaredAdultSignatory: true };

export async function createApplication(
  app: AppContext,
  session: SessionInfo,
  input: CreateInput,
  requestId: string,
): Promise<{ created: boolean; application: KycApplicationView }> {
  // A GSTIN can return a name through the prefill, so typing them must not enumerate businesses.
  if (input.gstin) enforceRateLimit(app, `gstin-lookup:${session.sessionId}`, RATE_LIMITS.gstinLookup);

  const catalogue = await app.catalogue();
  const quote = await loadQuote(app, catalogue, session.ownerId, input.quoteId);
  if (quote.row.status !== 'ACCEPTED') {
    throw new ApiError(409, 'QUOTE_NOT_ACCEPTED', 'Please accept the quote before starting verification.');
  }

  const existing = await findOpenApplicationForQuote(app, session.ownerId, input.quoteId);
  if (existing) return { created: false, application: await toApplicationView(app, existing) };

  const now = app.clock.now().toISOString();
  const id = newPublicId('kyc');
  const identity: KycIdentity = {
    contactName: input.contactName ?? null,
    businessName: input.businessName ?? null,
    gstin: input.gstin ?? null,
    udyamNumber: null,
  };
  const bundleNeedsGstin = quote.lines.some((line) => getProduct(catalogue, line.productId).requiresGstin);

  const [row] = await app.db
    .insert(kycApplications)
    .values({
      id,
      ownerId: session.ownerId,
      quoteId: input.quoteId,
      status: 'OPEN',
      bundleNeedsGstin: bundleNeedsGstin ? 1 : 0,
      gstinConfirmed: 0,
      contactNameSource: input.contactName ? 'OWNER' : null,
      sealedIdentity: sealIdentity(app.sealer, id, identity),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Inserting an application returned no row');

  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'KYC_APPLICATION_STARTED',
    objectType: 'kyc_application',
    objectId: id,
    requestId,
    metadata: { declaredAdultSignatory: input.declaredAdultSignatory },
  });

  // Assessed only once a document is in, so typing a number can't look up a stranger's registration.
  return { created: true, application: await toApplicationView(app, row) };
}

export async function getApplication(app: AppContext, ownerId: string, id: string): Promise<KycApplicationView> {
  return toApplicationView(app, await loadApplication(app, ownerId, id));
}

export async function setContactName(
  app: AppContext,
  session: SessionInfo,
  id: string,
  contactName: string,
  requestId: string,
): Promise<KycApplicationView> {
  const row = await loadOpen(app, session.ownerId, id);
  enforceRateLimit(app, `contact-change:${session.sessionId}`, RATE_LIMITS.contactChange);
  const identity = readIdentity(app.sealer, row);
  const updated = await updateApplication(app, id, {
    sealedIdentity: sealIdentity(app.sealer, id, { ...identity, contactName }),
    contactNameSource: 'OWNER',
  });
  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'CONTACT_NAME_CHANGED',
    objectType: 'kyc_application',
    objectId: id,
    requestId,
  });
  return toApplicationView(app, await assessApplication(app, updated, requestId));
}

/** The owner checked the number against their certificate. It's then judged exactly as they gave it. */
export async function confirmGstin(
  app: AppContext,
  session: SessionInfo,
  id: string,
  gstin: string,
  requestId: string,
): Promise<KycApplicationView> {
  const row = await loadOpen(app, session.ownerId, id);
  enforceRateLimit(app, `gstin-lookup:${session.sessionId}`, RATE_LIMITS.gstinLookup);

  // Only a correction to what we read, and only when we asked. Otherwise anyone could look up a
  // stranger's GSTIN here, or talk their way past a registry rejection.
  const read = await openConfirmationRead(app, id);
  if (read === null) throw new ApiError(409, 'CONFIRMATION_NOT_REQUESTED', 'We did not ask you to confirm a number for this application.');
  if (!isPlausibleCorrection(read, gstin)) {
    throw new ApiError(422, 'GSTIN_TOO_DIFFERENT', 'This is too different from your certificate. Please upload the certificate for this number.');
  }

  const identity = readIdentity(app.sealer, row);
  const updated = await updateApplication(app, id, {
    sealedIdentity: sealIdentity(app.sealer, id, { ...identity, gstin }),
    gstinConfirmed: 1,
  });
  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'GSTIN_CONFIRMED',
    objectType: 'kyc_application',
    objectId: id,
    requestId,
  });
  return toApplicationView(app, await assessApplication(app, updated, requestId));
}

/** Re-runs verification, which is how an owner gets past a registry outage. */
export async function reassessApplication(
  app: AppContext,
  session: SessionInfo,
  id: string,
  requestId: string,
): Promise<KycApplicationView> {
  const row = await loadOpen(app, session.ownerId, id);
  enforceRateLimit(app, `reassessment:${session.sessionId}`, RATE_LIMITS.reassessment);
  await readPendingDocuments(app, id);
  return toApplicationView(app, await assessApplication(app, row, requestId));
}

/** Called when a changed quote is accepted: the verdict must now describe the new bundle. */
export async function refreshApplicationForQuote(
  app: AppContext,
  ownerId: string,
  quoteId: string,
  bundleNeedsGstin: boolean,
  requestId: string,
): Promise<ApplicationRow | null> {
  const row = await findOpenApplicationForQuote(app, ownerId, quoteId);
  if (!row) return null;
  const updated = await updateApplication(app, row.id, { bundleNeedsGstin: bundleNeedsGstin ? 1 : 0, quoteChange: null });
  return assessApplication(app, updated, requestId);
}

/** What OCR read, if the assessment is waiting on the owner to check it. */
async function openConfirmationRead(app: AppContext, applicationId: string): Promise<string | null> {
  const checks = await listChecks(app, applicationId);
  const open = checks.find(
    (check) => (check.checkId === 'GST_FORMAT' || check.checkId === 'GST_FOUND') && check.outcome === 'FAIL' && check.onFail === 'NEEDS_CONFIRMATION',
  );
  if (!open) return null;
  const evidence = app.sealer.openJson<Record<string, string>>(open.sealedEvidence, evidenceContext(open.id));
  return evidence.read ?? '';
}

async function loadOpen(app: AppContext, ownerId: string, id: string): Promise<ApplicationRow> {
  const row = await loadApplication(app, ownerId, id);
  if (row.status !== 'OPEN') throw new ApiError(409, 'APPLICATION_CLOSED', 'This application is closed.');
  return row;
}
