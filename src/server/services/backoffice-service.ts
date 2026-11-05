import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { AdvisorFacts } from '../../domain/advisor/advisor-facts';
import { propensityScore, type PropensityModel } from '../../domain/analytics/propensity';
import type { AppContext } from '../app-context';
import { recordAudit } from '../db/repositories/audit-repository';
import { conversations, leads } from '../db/schema';

// Stages where a person could still move things along, past the first contact.
const WORTH_A_CALL = ['Contacted', 'Needs assessed', 'Quote accepted', 'KYC complete'];
const TOP_LEADS = 25;

/**
 * Chats the advisor handed to a person: business facts and a reason, with no chat text, name or
 * identifier. Someone following up gets what they need, and nothing more.
 */
export async function listHandoffs(app: AppContext, requestId: string) {
  await recordAudit(app, { actorRef: 'admin', action: 'BACKOFFICE_HANDOFFS_READ', objectType: 'backoffice', requestId });
  const rows = await app.db
    .select({ id: conversations.id, reason: conversations.handoffReason, facts: conversations.facts, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.status, 'HANDED_OFF'), isNotNull(conversations.handoffReason)))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);

  return {
    items: rows.map((row) => {
      const { facts } = JSON.parse(row.facts ?? '{}') as { facts?: AdvisorFacts };
      return {
        id: row.id,
        reason: row.reason,
        when: row.updatedAt,
        businessType: facts?.businessType ?? null,
        segment: facts?.segment ?? null,
        city: facts?.city ?? null,
        employeeCount: facts?.employeeCount ?? null,
        numSites: facts?.numSites ?? null,
        gstinStatus: facts?.gstinStatus ?? null,
        needs: facts?.needs ?? [],
      };
    }),
    nextCursor: null,
  };
}

let model: Promise<PropensityModel> | null = null;

function loadModel(): Promise<PropensityModel> {
  model ??= readFile(path.resolve(/*turbopackIgnore: true*/ 'analytics/output/propensity.json'), 'utf8').then(
    (text) => (JSON.parse(text) as { model: PropensityModel }).model,
  );
  return model;
}

/**
 * Leads that dropped early, ranked by how likely they are to activate. Only fields known when a
 * lead was created are used, so the score can't lean on what happened later. The seeded leads table
 * holds a subset of the features, and a missing one simply adds nothing to the score.
 */
export async function listTopLeads(app: AppContext, requestId: string) {
  await recordAudit(app, { actorRef: 'admin', action: 'BACKOFFICE_LEADS_READ', objectType: 'backoffice', requestId });
  const scoring = await loadModel();
  const rows = await app.db
    .select({
      id: leads.id,
      businessType: leads.businessType,
      segment: leads.segment,
      city: leads.city,
      cityTier: leads.cityTier,
      employeeCount: leads.employeeCount,
      numSites: leads.numSites,
      leadSource: leads.leadSource,
      contactRole: leads.contactRole,
      gstin: leads.gstin,
      udyamNumber: leads.udyamNumber,
      stageReached: leads.stageReached,
    })
    .from(leads)
    .where(and(ne(leads.outcome, 'Activated'), inArray(leads.stageReached, WORTH_A_CALL)));

  const scored = rows.map(({ gstin, udyamNumber, ...row }) => ({
    ...row,
    hasGstin: gstin !== null && gstin !== '',
    score: propensityScore(scoring, {
      categories: {
        lead_source: row.leadSource,
        segment: row.segment,
        city_tier: String(row.cityTier),
        has_gstin: gstin ? 'Y' : 'N',
        has_udyam: udyamNumber ? 'Y' : 'N',
        contact_role: row.contactRole,
      },
      numbers: { employee_count: row.employeeCount, num_sites: row.numSites },
    }),
  }));

  return { items: scored.sort((a, b) => b.score - a.score).slice(0, TOP_LEADS), nextCursor: null };
}
