import { and, eq, ne } from 'drizzle-orm';
import { addProduct, removeProduct, revalidateBundle } from '../../domain/bundle/bundle-changes';
import { getProduct } from '../../domain/catalogue/catalogue';
import { checkBundle, type BusinessProfile, type GstinStatus } from '../../domain/eligibility/eligibility';
import {
  compareQuotes,
  defaultQuantity,
  type BundleLine,
  type QuoteComparison,
} from '../../domain/pricing/pricing';
import type { AppContext } from '../app-context';
import type { SessionInfo } from '../auth/session-service';
import { recordAudit } from '../db/repositories/audit-repository';
import { orders } from '../db/schema';
import { ApiError, notFound } from '../http/errors';
import { toPage, type Page, type PageQuery } from '../http/request';
import {
  insertQuote,
  listQuotes,
  loadQuote,
  updateQuoteLines,
  updateQuoteRow,
  type StoredQuote,
} from './quote-repository';
import {
  NO_CHANGE,
  toBlockedView,
  toQuoteView,
  toStrandedView,
  totalsOf,
  type BlockedView,
  type QuoteTotals,
  type QuoteView,
} from './quote-view';

const QUOTE_LOCKED_MESSAGE = 'This quote has been accepted, so it can no longer be changed.';

export async function createQuote(
  app: AppContext,
  ownerId: string,
  input: { profile: BusinessProfile; lines: readonly BundleLine[] },
): Promise<QuoteView> {
  const catalogue = await app.catalogue();
  const unknown = input.lines.find((line) => !catalogue.byId.has(line.productId));
  if (unknown) throw new ApiError(422, 'UNKNOWN_PRODUCT', 'That product is not in our catalogue.', { productId: unknown.productId });

  const { lines, dropped } = revalidateBundle(catalogue, input.profile, input.lines);
  const stored = await insertQuote(app, catalogue, { ownerId, profile: input.profile, lines });
  return toQuoteView(catalogue, stored, { ...NO_CHANGE, blocked: dropped.map((result) => toBlockedView(catalogue, result)) });
}

export async function getQuote(app: AppContext, ownerId: string, quoteId: string): Promise<QuoteView> {
  const catalogue = await app.catalogue();
  return toQuoteView(catalogue, await loadQuote(app, catalogue, ownerId, quoteId));
}

export async function pageQuotes(app: AppContext, ownerId: string, page: PageQuery): Promise<Page<QuoteView>> {
  const catalogue = await app.catalogue();
  const rows = await listQuotes(app, catalogue, ownerId, page);
  return toPage(rows, page.limit, (stored) => stored.row.id, (stored) => toQuoteView(catalogue, stored));
}

/** Adds a line or changes its quantity. A blocked add-on leaves the quote as it was. */
export async function setQuoteLine(
  app: AppContext,
  ownerId: string,
  quoteId: string,
  productId: string,
  quantity: number | undefined,
): Promise<QuoteView> {
  const catalogue = await app.catalogue();
  const stored = await loadQuote(app, catalogue, ownerId, quoteId);
  assertEditable(stored);
  if (!catalogue.byId.has(productId)) throw notFound();

  const wanted = quantity ?? defaultQuantity(getProduct(catalogue, productId), stored.profile);
  const result = addProduct(catalogue, stored.profile, stored.lines, { productId, quantity: wanted });

  if (result.status === 'BLOCKED') {
    return toQuoteView(catalogue, stored, {
      applied: false,
      comparison: compareQuotes(stored.priced, stored.priced),
      stranded: [],
      blocked: [toBlockedView(catalogue, result.eligibility)],
    });
  }

  const updated = await updateQuoteLines(app, catalogue, stored, result.lines);
  return toQuoteView(catalogue, updated, {
    applied: true,
    comparison: compareQuotes(stored.priced, updated.priced),
    stranded: [],
    blocked: [],
  });
}

/** Removes a line and anything left without a base, and says what went. */
export async function removeQuoteLine(app: AppContext, ownerId: string, quoteId: string, productId: string): Promise<QuoteView> {
  const catalogue = await app.catalogue();
  const stored = await loadQuote(app, catalogue, ownerId, quoteId);
  assertEditable(stored);
  if (!stored.lines.some((line) => line.productId === productId)) {
    return toQuoteView(catalogue, stored, { ...NO_CHANGE, comparison: compareQuotes(stored.priced, stored.priced) });
  }

  const { lines, stranded } = removeProduct(catalogue, stored.lines, productId);
  const updated = await updateQuoteLines(app, catalogue, stored, lines);
  return toQuoteView(catalogue, updated, {
    applied: true,
    comparison: compareQuotes(stored.priced, updated.priced),
    stranded: stranded.map((item) => toStrandedView(catalogue, item)),
    blocked: [],
  });
}

export async function saveQuote(app: AppContext, ownerId: string, quoteId: string): Promise<QuoteView> {
  const catalogue = await app.catalogue();
  const stored = await loadQuote(app, catalogue, ownerId, quoteId);
  assertEditable(stored);
  const saved = await updateQuoteRow(app, catalogue, stored, { status: 'SAVED', savedAt: app.clock.now().toISOString() });
  return toQuoteView(catalogue, saved);
}

/** Rules run once more here, so a quote can't be accepted on facts that have since changed. */
export async function acceptQuote(app: AppContext, session: SessionInfo, quoteId: string, requestId: string): Promise<QuoteView> {
  const catalogue = await app.catalogue();
  const stored = await loadQuote(app, catalogue, session.ownerId, quoteId);
  if (stored.row.status === 'ACCEPTED') return toQuoteView(catalogue, stored);
  if (stored.lines.length === 0) throw new ApiError(422, 'EMPTY_QUOTE', 'Please add at least one product to this quote.');

  const ids = stored.lines.map((line) => line.productId);
  const blocked = checkBundle(catalogue, stored.profile, ids).filter((result) => !result.eligible);
  if (blocked.length > 0) {
    throw new ApiError(422, 'QUOTE_NOT_ELIGIBLE', 'Some items in this quote are no longer available to you.', {
      blocked: blocked.map((result) => toBlockedView(catalogue, result)),
    });
  }

  const accepted = await updateQuoteRow(app, catalogue, stored, {
    status: 'ACCEPTED',
    acceptedAt: app.clock.now().toISOString(),
  });
  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'QUOTE_ACCEPTED',
    objectType: 'quote',
    objectId: quoteId,
    requestId,
    metadata: { revision: accepted.row.revision },
  });
  return toQuoteView(catalogue, accepted);
}

export type KycQuoteChange = {
  reason: 'GSTIN_STATUS';
  gstinStatus: GstinStatus;
  dropped: BlockedView[];
  before: QuoteTotals;
  after: QuoteTotals;
  comparison: QuoteComparison;
  requiresAcceptance: true;
};

/**
 * KYC found the GSTIN differs from what the owner said. Records the fact, and if products can no
 * longer be sold, reprices without them and asks the owner to accept again.
 */
export async function applyGstinFinding(
  app: AppContext,
  ownerId: string,
  quoteId: string,
  gstinStatus: GstinStatus,
): Promise<KycQuoteChange | null> {
  const catalogue = await app.catalogue();
  const stored = await loadQuote(app, catalogue, ownerId, quoteId);
  if (stored.profile.gstinStatus === gstinStatus) return null;

  // An order fixes what was sold. Any later change to the facts is for a person to handle.
  const [liveOrder] = await app.db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.quoteId, quoteId), ne(orders.status, 'CANCELLED')))
    .limit(1);
  if (liveOrder) return null;

  const { lines, dropped } = revalidateBundle(catalogue, { ...stored.profile, gstinStatus }, stored.lines);
  if (dropped.length === 0) {
    await updateQuoteRow(app, catalogue, stored, { gstinStatus });
    return null;
  }

  const updated = await updateQuoteLines(app, catalogue, stored, lines, { status: 'NEEDS_ACCEPTANCE', gstinStatus });
  return {
    reason: 'GSTIN_STATUS',
    gstinStatus,
    dropped: dropped.map((result) => toBlockedView(catalogue, result)),
    before: totalsOf(stored.priced),
    after: totalsOf(updated.priced),
    comparison: compareQuotes(stored.priced, updated.priced),
    requiresAcceptance: true,
  };
}

function assertEditable(stored: StoredQuote): void {
  if (stored.row.status === 'ACCEPTED') throw new ApiError(409, 'QUOTE_LOCKED', QUOTE_LOCKED_MESSAGE);
}
