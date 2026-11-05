import { api } from '@/lib/api-client';
import type { Recommendation } from '@/server/services/advisor/reply-plan';

/** The server prices it again from the catalogue, so nothing here can set a price. */
export async function createQuoteFrom(recommendation: Recommendation): Promise<void> {
  const { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable } = recommendation.profile;
  await api.post('/quotes', {
    profile: { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable },
    lines: recommendation.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  });
}
