import { and, asc, eq, gt } from 'drizzle-orm';
import type { BusinessProfile, GstinStatus } from '../../domain/eligibility/eligibility';
import { priceBundle, type BundleLine, type Quote } from '../../domain/pricing/pricing';
import type { Catalogue } from '../../domain/catalogue/catalogue';
import { newPublicId } from '../../lib/ids';
import type { Clock } from '../../lib/clock';
import type { Database } from '../db/client';
import { quoteLines, quotes } from '../db/schema';
import { notFound } from '../http/errors';

export type QuoteRow = typeof quotes.$inferSelect;

export type StoredQuote = { row: QuoteRow; lines: BundleLine[]; priced: Quote; profile: BusinessProfile };

type Deps = { db: Database; clock: Clock };

export function profileOf(row: QuoteRow): BusinessProfile {
  return {
    cityTier: row.cityTier,
    employeeCount: row.employeeCount,
    numSites: row.numSites,
    gstinStatus: row.gstinStatus as GstinStatus,
    fibreAvailable: row.fibreAvailable === null ? null : row.fibreAvailable === 1,
  };
}

/** Every read filters by owner, so a wrong owner and a missing quote look the same: 404. */
export async function loadQuote(deps: Deps, catalogue: Catalogue, ownerId: string, quoteId: string): Promise<StoredQuote> {
  const [row] = await deps.db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound();
  return toStored(deps, catalogue, row);
}

async function toStored(deps: Deps, catalogue: Catalogue, row: QuoteRow): Promise<StoredQuote> {
  const lines = await deps.db
    .select({ productId: quoteLines.productId, quantity: quoteLines.quantity })
    .from(quoteLines)
    .where(eq(quoteLines.quoteId, row.id))
    // By product ID, which lists connections first, since line IDs are random.
    .orderBy(asc(quoteLines.productId));
  return { row, lines, priced: priceBundle(catalogue, lines), profile: profileOf(row) };
}

export async function listQuotes(
  deps: Deps,
  catalogue: Catalogue,
  ownerId: string,
  page: { limit: number; cursor?: string },
): Promise<StoredQuote[]> {
  const rows = await deps.db
    .select()
    .from(quotes)
    .where(and(eq(quotes.ownerId, ownerId), page.cursor ? gt(quotes.id, page.cursor) : undefined))
    .orderBy(asc(quotes.id))
    .limit(page.limit + 1);
  return Promise.all(rows.map((row) => toStored(deps, catalogue, row)));
}

export async function insertQuote(
  deps: Deps,
  catalogue: Catalogue,
  input: { ownerId: string; profile: BusinessProfile; lines: readonly BundleLine[] },
): Promise<StoredQuote> {
  const now = deps.clock.now().toISOString();
  const priced = priceBundle(catalogue, input.lines);
  const id = newPublicId('qt');
  await deps.db.insert(quotes).values({
    id,
    ownerId: input.ownerId,
    status: 'DRAFT',
    revision: 1,
    cityTier: input.profile.cityTier,
    employeeCount: input.profile.employeeCount,
    numSites: input.profile.numSites,
    gstinStatus: input.profile.gstinStatus,
    fibreAvailable: input.profile.fibreAvailable === null ? null : input.profile.fibreAvailable ? 1 : 0,
    ...totals(priced),
    createdAt: now,
    updatedAt: now,
  });
  await replaceLines(deps, id, priced, now);
  return loadQuote(deps, catalogue, input.ownerId, id);
}

/** Writes new lines and totals together and moves the revision on. */
export async function updateQuoteLines(
  deps: Deps,
  catalogue: Catalogue,
  stored: StoredQuote,
  lines: readonly BundleLine[],
  changes: Partial<Pick<QuoteRow, 'status' | 'gstinStatus'>> = {},
): Promise<StoredQuote> {
  const now = deps.clock.now().toISOString();
  const priced = priceBundle(catalogue, lines);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(quotes)
      .set({ ...totals(priced), ...changes, revision: stored.row.revision + 1, updatedAt: now })
      .where(eq(quotes.id, stored.row.id));
    await tx.delete(quoteLines).where(eq(quoteLines.quoteId, stored.row.id));
    if (priced.lines.length > 0) {
      await tx.insert(quoteLines).values(lineRows(stored.row.id, priced, now));
    }
  });
  return loadQuote(deps, catalogue, stored.row.ownerId, stored.row.id);
}

export async function updateQuoteRow(
  deps: Deps,
  catalogue: Catalogue,
  stored: StoredQuote,
  changes: Partial<QuoteRow>,
): Promise<StoredQuote> {
  const now = deps.clock.now().toISOString();
  await deps.db.update(quotes).set({ ...changes, updatedAt: now }).where(eq(quotes.id, stored.row.id));
  return loadQuote(deps, catalogue, stored.row.ownerId, stored.row.id);
}

function totals(priced: Quote) {
  return {
    monthlyTotalInr: priced.monthlyTotalInr,
    setupTotalInr: priced.setupTotalInr,
    contractMonths: priced.contractMonths,
    installDays: priced.installDays,
  };
}

async function replaceLines(deps: Deps, quoteId: string, priced: Quote, now: string): Promise<void> {
  if (priced.lines.length === 0) return;
  await deps.db.insert(quoteLines).values(lineRows(quoteId, priced, now));
}

function lineRows(quoteId: string, priced: Quote, now: string) {
  return priced.lines.map((line) => ({
    id: newPublicId('ql'),
    quoteId,
    productId: line.productId,
    quantity: line.quantity,
    unitPriceInr: line.unitPriceInr,
    monthlyInr: line.monthlyInr,
    setupInr: line.setupInr,
    createdAt: now,
    updatedAt: now,
  }));
}
