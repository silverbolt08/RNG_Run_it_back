import { getProduct, type Catalogue } from '../catalogue/catalogue';
import {
  checkBundle,
  checkProduct,
  type BusinessProfile,
  type EligibilityResult,
} from '../eligibility/eligibility';
import type { BundleLine } from '../pricing/pricing';

export type StrandedProduct = { productId: string; requiredOneOf: string[] };

export type RemovalResult = { lines: BundleLine[]; stranded: StrandedProduct[] };

export type AddResult =
  | { status: 'ADDED'; lines: BundleLine[] }
  | { status: 'BLOCKED'; lines: BundleLine[]; eligibility: EligibilityResult };

export type RevalidationResult = { lines: BundleLine[]; dropped: EligibilityResult[] };

/** Removes a product, and anything left without a base, so the screen can warn about both. */
export function removeProduct(
  catalogue: Catalogue,
  lines: readonly BundleLine[],
  productId: string,
): RemovalResult {
  let remaining = lines.filter((line) => line.productId !== productId);
  const stranded: StrandedProduct[] = [];

  for (;;) {
    const ids = remaining.map((line) => line.productId);
    const lost = remaining.filter((line) => {
      const { requiresOneOf } = getProduct(catalogue, line.productId);
      return requiresOneOf.length > 0 && !requiresOneOf.some((base) => ids.includes(base));
    });
    if (lost.length === 0) return { lines: remaining, stranded };

    for (const line of lost) {
      stranded.push({
        productId: line.productId,
        requiredOneOf: getProduct(catalogue, line.productId).requiresOneOf,
      });
    }
    remaining = remaining.filter((line) => !lost.includes(line));
  }
}

/** Adds a product or changes its quantity, unless the rules block it. */
export function addProduct(
  catalogue: Catalogue,
  profile: BusinessProfile,
  lines: readonly BundleLine[],
  line: BundleLine,
): AddResult {
  const others = lines.filter((existing) => existing.productId !== line.productId);
  const ids = [...others.map((existing) => existing.productId), line.productId];
  const eligibility = checkProduct(catalogue, line.productId, profile, ids);

  if (!eligibility.eligible) return { status: 'BLOCKED', lines: [...lines], eligibility };

  const alreadyPresent = others.length !== lines.length;
  return {
    status: 'ADDED',
    lines: alreadyPresent
      ? lines.map((existing) => (existing.productId === line.productId ? line : existing))
      : [...lines, line],
  };
}

/**
 * Re-checks a bundle after the facts change, such as KYC finding a GSTIN Cancelled or the owner
 * correcting their size. It repeats because dropping a base can strand what depended on it.
 */
export function revalidateBundle(
  catalogue: Catalogue,
  profile: BusinessProfile,
  lines: readonly BundleLine[],
): RevalidationResult {
  let remaining = [...lines];
  const dropped: EligibilityResult[] = [];

  for (;;) {
    const ineligible = checkBundle(
      catalogue,
      profile,
      remaining.map((line) => line.productId),
    ).filter((result) => !result.eligible);
    if (ineligible.length === 0) return { lines: remaining, dropped };

    dropped.push(...ineligible);
    const droppedIds = ineligible.map((result) => result.productId);
    remaining = remaining.filter((line) => !droppedIds.includes(line.productId));
  }
}
