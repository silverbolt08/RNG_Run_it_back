import { and, desc, eq, sql } from 'drizzle-orm';
import { getProduct } from '../../domain/catalogue/catalogue';
import type { AppContext } from '../app-context';
import type { SessionInfo } from '../auth/session-service';
import { kycApplications, orders, quotes } from '../db/schema';
import { refreshApplicationForQuote } from './kyc/kyc-service';
import { acceptQuote } from './quote-service';
import type { QuoteView } from './quote-view';

export type Journey = {
  quoteId: string | null;
  /** The application for the latest quote, because a new quote needs its own verification. */
  kycApplicationId: string | null;
  orderId: string | null;
  /** Whether the latest order is for the latest quote. Otherwise a newer quote is still in progress. */
  orderForQuote: boolean;
};

/** The owner's most recent work, so a return visit can pick up where they left off. */
export async function findJourney(app: AppContext, ownerId: string): Promise<Journey> {
  const [quote] = await app.db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.ownerId, ownerId))
    .orderBy(desc(sql`rowid`))
    .limit(1);
  const [application] = await app.db
    .select({ id: kycApplications.id })
    .from(kycApplications)
    .where(and(eq(kycApplications.ownerId, ownerId), eq(kycApplications.quoteId, quote?.id ?? '')))
    .orderBy(desc(sql`rowid`))
    .limit(1);
  const [order] = await app.db
    .select({ id: orders.id, quoteId: orders.quoteId, status: orders.status })
    .from(orders)
    .where(eq(orders.ownerId, ownerId))
    .orderBy(desc(sql`rowid`))
    .limit(1);
  return {
    quoteId: quote?.id ?? null,
    kycApplicationId: application?.id ?? null,
    orderId: order?.id ?? null,
    orderForQuote: order !== undefined && order.quoteId === quote?.id && order.status !== 'CANCELLED',
  };
}

export type AcceptedQuoteView = QuoteView & { kycApplication: { id: string; verdict: string | null } | null };

/**
 * Accepting a quote that KYC changed also re-runs KYC against the new bundle, so the verdict the
 * owner sees next is about what they just agreed to.
 */
export async function acceptQuoteAndRefreshKyc(
  app: AppContext,
  session: SessionInfo,
  quoteId: string,
  requestId: string,
): Promise<AcceptedQuoteView> {
  const quote = await acceptQuote(app, session, quoteId, requestId);
  const catalogue = await app.catalogue();
  const needsGstin = quote.lines.some((line) => getProduct(catalogue, line.productId).requiresGstin);
  const application = await refreshApplicationForQuote(app, session.ownerId, quoteId, needsGstin, requestId);
  return {
    ...quote,
    kycApplication: application ? { id: application.id, verdict: application.verdict } : null,
  };
}
