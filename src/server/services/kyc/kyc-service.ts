import { getProduct } from '../../../domain/catalogue/catalogue';
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
  findOpenApplicationForQuote,
  loadApplication,
  readIdentity,
  sealIdentity,
  updateApplication,
  type ApplicationRow,
  type KycIdentity,
} from './kyc-repository';
import { toApplicationView, type KycApplicationView } from './kyc-view';

export type CreateInput = { quoteId: string; contactName?: string; businessName?: string; gstin?: string };

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
  });

  // With a number up front, a lookup can prefill the contact name right away.
  const assessed = input.gstin ? await assessApplication(app, row, requestId) : row;
  return { created: true, application: await toApplicationView(app, assessed) };
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
  const identity = readIdentity(app.sealer, row);
  const updated = await updateApplication(app, id, {
    sealedIdentity: sealIdentity(app.sealer, id, { ...identity, contactName }),
    contactNameSource: 'OWNER',
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

async function loadOpen(app: AppContext, ownerId: string, id: string): Promise<ApplicationRow> {
  const row = await loadApplication(app, ownerId, id);
  if (row.status !== 'OPEN') throw new ApiError(409, 'APPLICATION_CLOSED', 'This application is closed.');
  return row;
}
