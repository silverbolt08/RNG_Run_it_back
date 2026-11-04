import { getProduct, type Catalogue, type Product } from '../../domain/catalogue/catalogue';
import type { EligibilityResult } from '../../domain/eligibility/eligibility';
import { GST_RATE_PERCENT, type Quote, type QuoteComparison, type QuoteLine } from '../../domain/pricing/pricing';
import type { StrandedProduct } from '../../domain/bundle/bundle-changes';
import type { StoredQuote } from './quote-repository';

export type NamedProduct = { name: string; description: string; unit: string };

export const namesOf = (product: Product): NamedProduct => ({
  name: product.name,
  description: product.description,
  unit: product.unit,
});

export type QuoteLineView = QuoteLine & NamedProduct;
export type BlockedView = EligibilityResult & { name: string };
export type StrandedView = StrandedProduct & { name: string };

export type QuoteChange = {
  applied: boolean;
  comparison: QuoteComparison | null;
  stranded: StrandedView[];
  blocked: BlockedView[];
};

/** Everything on the domain's Quote except its lines, so a new total reaches the API by itself. */
export type QuoteTotals = Omit<Quote, 'lines'>;

export function totalsOf(quote: Quote): QuoteTotals {
  const totals: Partial<Quote> = { ...quote };
  delete totals.lines;
  return totals as QuoteTotals;
}

export type QuoteView = {
  id: string;
  status: string;
  revision: number;
  gstRatePercent: number;
  profile: StoredQuote['profile'];
  lines: QuoteLineView[];
  savedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
} & QuoteTotals &
  QuoteChange;

export const NO_CHANGE: QuoteChange = { applied: false, comparison: null, stranded: [], blocked: [] };

export function toBlockedView(catalogue: Catalogue, result: EligibilityResult): BlockedView {
  return { ...result, name: getProduct(catalogue, result.productId).name };
}

export function toStrandedView(catalogue: Catalogue, item: StrandedProduct): StrandedView {
  return { ...item, name: getProduct(catalogue, item.productId).name };
}

export function toQuoteView(catalogue: Catalogue, stored: StoredQuote, change: QuoteChange = NO_CHANGE): QuoteView {
  const { row, priced, profile } = stored;
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    gstRatePercent: GST_RATE_PERCENT,
    profile,
    lines: priced.lines.map((line) => ({ ...line, ...namesOf(getProduct(catalogue, line.productId)) })),
    ...totalsOf(priced),
    savedAt: row.savedAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...change,
  };
}
