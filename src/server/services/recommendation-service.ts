import { recommendBundle, type DiscoveryProfile, type Need } from '../../domain/bundle/recommend-bundle';
import { inferSegment, lookupCityTier } from '../../domain/bundle/segments';
import { getProduct } from '../../domain/catalogue/catalogue';
import type { GstinStatus } from '../../domain/eligibility/eligibility';
import { GST_RATE_PERCENT } from '../../domain/pricing/pricing';
import type { AppContext } from '../app-context';
import { namesOf } from './quote-view';

export type DiscoveryInput = {
  businessType?: string;
  city?: string;
  cityTier?: number | null;
  segment?: DiscoveryProfile['segment'];
  employeeCount: number | null;
  numSites: number | null;
  gstinStatus: GstinStatus;
  fibreAvailable: boolean | null;
  connectivity: DiscoveryProfile['connectivity'];
  needs: readonly Need[];
  requestedProducts?: readonly string[];
  counts: DiscoveryProfile['counts'];
};

/**
 * The guided, LLM-free path. The advisor's `recommend_bundle` tool will call this too, so both
 * reach the same rules. It keeps nothing, because a recommendation is a calculation.
 */
export async function recommend(app: AppContext, input: DiscoveryInput) {
  const catalogue = await app.catalogue();
  const profile: DiscoveryProfile = {
    cityTier: input.cityTier ?? (input.city ? lookupCityTier(input.city) : null),
    employeeCount: input.employeeCount,
    numSites: input.numSites,
    gstinStatus: input.gstinStatus,
    fibreAvailable: input.fibreAvailable,
    segment: input.segment ?? (input.businessType ? inferSegment(input.businessType, input.numSites) : null),
    connectivity: input.connectivity,
    needs: input.needs,
    requestedProducts: input.requestedProducts ?? [],
    counts: input.counts,
  };

  const recommendation = recommendBundle(catalogue, profile);
  return {
    profile: {
      cityTier: profile.cityTier,
      employeeCount: profile.employeeCount,
      numSites: profile.numSites,
      gstinStatus: profile.gstinStatus,
      fibreAvailable: profile.fibreAvailable,
      segment: profile.segment,
    },
    lines: recommendation.lines.map((line) => ({ ...line, ...namesOf(getProduct(catalogue, line.productId)) })),
    blocked: recommendation.blocked.map((item) => ({ ...item, name: getProduct(catalogue, item.productId).name })),
    // So a screen can name alternatives to a blocked product without a product code in sight.
    alternativeNames: Object.fromEntries(
      recommendation.blocked
        .flatMap((item) => item.alternatives)
        .map((id) => [id, getProduct(catalogue, id).name]),
    ),
    quote: { ...recommendation.quote, gstRatePercent: GST_RATE_PERCENT },
  };
}
