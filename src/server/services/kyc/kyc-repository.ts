import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../../../lib/clock';
import type { Sealer } from '../../crypto/sealer';
import type { Database } from '../../db/client';
import { kycApplications, kycChecks, kycDocuments, leads } from '../../db/schema';
import { notFound } from '../../http/errors';

export type ApplicationRow = typeof kycApplications.$inferSelect;
export type DocumentRow = typeof kycDocuments.$inferSelect;
export type CheckRow = typeof kycChecks.$inferSelect;

type Deps = { db: Database; clock: Clock };

/** Personal values for one application, stored only in sealed form. */
export type KycIdentity = {
  contactName: string | null;
  businessName: string | null;
  gstin: string | null;
  udyamNumber: string | null;
};

const EMPTY_IDENTITY: KycIdentity = { contactName: null, businessName: null, gstin: null, udyamNumber: null };

// Each sealed value is bound to its row, so it can't be pasted onto another applicant's.
export const identityContext = (applicationId: string) => `kyc-identity:${applicationId}`;
export const fieldsContext = (documentId: string) => `kyc-fields:${documentId}`;
export const evidenceContext = (checkId: string) => `kyc-evidence:${checkId}`;

export function readIdentity(sealer: Sealer, row: ApplicationRow): KycIdentity {
  return row.sealedIdentity ? sealer.openJson<KycIdentity>(row.sealedIdentity, identityContext(row.id)) : EMPTY_IDENTITY;
}

export function sealIdentity(sealer: Sealer, applicationId: string, identity: KycIdentity): string {
  return sealer.sealJson(identity, identityContext(applicationId));
}

/** Filters by owner, so a wrong owner and a missing application look the same: 404. */
export async function loadApplication(deps: Deps, ownerId: string, id: string): Promise<ApplicationRow> {
  const [row] = await deps.db
    .select()
    .from(kycApplications)
    .where(and(eq(kycApplications.id, id), eq(kycApplications.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

export async function findOpenApplicationForQuote(deps: Deps, ownerId: string, quoteId: string): Promise<ApplicationRow | null> {
  const [row] = await deps.db
    .select()
    .from(kycApplications)
    .where(
      and(
        eq(kycApplications.quoteId, quoteId),
        eq(kycApplications.ownerId, ownerId),
        eq(kycApplications.status, 'OPEN'),
      ),
    )
    .orderBy(desc(kycApplications.createdAt))
    .limit(1);
  return row ?? null;
}

export async function updateApplication(deps: Deps, id: string, changes: Partial<ApplicationRow>): Promise<ApplicationRow> {
  const [row] = await deps.db
    .update(kycApplications)
    .set({ ...changes, updatedAt: deps.clock.now().toISOString() })
    .where(eq(kycApplications.id, id))
    .returning();
  if (!row) throw notFound();
  return row;
}

/** The documents that count: the latest of each type, in upload order. */
export async function listActiveDocuments(deps: Deps, applicationId: string): Promise<DocumentRow[]> {
  return deps.db
    .select()
    .from(kycDocuments)
    .where(and(eq(kycDocuments.applicationId, applicationId), isNull(kycDocuments.supersededAt)))
    .orderBy(asc(kycDocuments.createdAt));
}

export async function listChecks(deps: Deps, applicationId: string): Promise<CheckRow[]> {
  return deps.db.select().from(kycChecks).where(eq(kycChecks.applicationId, applicationId));
}

export type LeadMatch = { contactName: string; businessName: string; udyamNumber: string | null };

/** Matches on GSTIN, not business name: 3,066 lead rows repeat an earlier business name. */
export async function findLeadByGstin(deps: Deps, gstin: string): Promise<LeadMatch | null> {
  const [row] = await deps.db
    .select({ contactName: leads.contactName, businessName: leads.businessName, udyamNumber: leads.udyamNumber })
    .from(leads)
    .where(eq(leads.gstin, gstin))
    .orderBy(asc(leads.id))
    .limit(1);
  return row ?? null;
}
