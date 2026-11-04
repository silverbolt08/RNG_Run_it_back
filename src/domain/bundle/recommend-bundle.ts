import { getProduct, type Catalogue, type SegmentCode } from '../catalogue/catalogue';
import { checkProduct, type BusinessProfile, type EligibilityResult } from '../eligibility/eligibility';
import {
  defaultQuantity,
  priceBundle,
  type BundleLine,
  type Quote,
  type UnitCounts,
} from '../pricing/pricing';

export type Need =
  | 'UPTIME'
  | 'CUSTOMER_OUTREACH'
  | 'BULK_SMS'
  | 'SECURITY'
  | 'GUEST_WIFI'
  | 'CENTRAL_MANAGEMENT'
  | 'PHONE_LINES'
  | 'BUSINESS_CALLS'
  | 'TOLL_FREE'
  | 'EMAIL'
  | 'BACKUP'
  | 'WEBSITE'
  | 'POS'
  | 'CCTV'
  | 'REMOTE_ACCESS'
  | 'FLEET'
  | 'MACHINE_MONITORING';

/** What the owner wants from their main connection. NONE is for owners who only want, say, a mobile plan. */
export type Connectivity = 'NONE' | 'STANDARD' | 'HIGH_SPEED' | 'DEDICATED' | 'DEDICATED_HIGH';

export type DiscoveryProfile = BusinessProfile & {
  segment: SegmentCode | null;
  connectivity: Connectivity;
  needs: readonly Need[];
  counts: UnitCounts;
};

export type LineReason = { kind: 'CONNECTIVITY' } | { kind: 'NEED'; need: Need };

export type RecommendedLine = BundleLine & { reason: LineReason };

export type BlockedRecommendation = EligibilityResult & { need: Need | null };

export type Recommendation = {
  lines: RecommendedLine[];
  blocked: BlockedRecommendation[];
  quote: Quote;
};

const AIRFIBER_ID = 'P04';

// Each list runs from what was asked for to the nearest thing that may be allowed.
const STANDARD_CONNECTIVITY: Readonly<Record<SegmentCode, readonly string[]>> = {
  micro: ['P01', AIRFIBER_ID],
  prof: ['P02', AIRFIBER_ID],
  multi: ['P02', AIRFIBER_ID],
  mfg: ['P02', AIRFIBER_ID],
};

const REQUESTED_CONNECTIVITY: Readonly<Record<Exclude<Connectivity, 'NONE' | 'STANDARD'>, readonly string[]>> = {
  HIGH_SPEED: ['P03', 'P02', AIRFIBER_ID],
  DEDICATED: ['P05', 'P02', AIRFIBER_ID],
  DEDICATED_HIGH: ['P06', 'P05', 'P02', AIRFIBER_ID],
};

const PRODUCTS_FOR_NEED: Readonly<Record<Exclude<Need, 'PHONE_LINES' | 'SECURITY'>, readonly string[]>> = {
  UPTIME: ['P09'],
  CUSTOMER_OUTREACH: ['P15'],
  BULK_SMS: ['P14'],
  GUEST_WIFI: ['P22'],
  CENTRAL_MANAGEMENT: ['P10'],
  BUSINESS_CALLS: ['P12'],
  TOLL_FREE: ['P13'],
  EMAIL: ['P16'],
  BACKUP: ['P17'],
  WEBSITE: ['P18'],
  POS: ['P19'],
  CCTV: ['P23'],
  REMOTE_ACCESS: ['P11'],
  FLEET: ['P25'],
  MACHINE_MONITORING: ['P24'],
};

/**
 * Chooses a bundle in code, so the LLM only has to explain it. It adds nothing beyond the
 * connection and the stated needs, so a price-sensitive owner isn't upsold. Anything the rules
 * block is recorded with its reason, never dropped silently.
 */
export function recommendBundle(catalogue: Catalogue, profile: DiscoveryProfile): Recommendation {
  const lines: RecommendedLine[] = [];
  const blocked: BlockedRecommendation[] = [];

  const connection = chooseConnection(catalogue, profile);
  if (connection.productId) {
    lines.push(toLine(catalogue, profile, connection.productId, { kind: 'CONNECTIVITY' }));
  }
  if (connection.blocked) blocked.push({ ...connection.blocked, need: null });

  for (const need of profile.needs) {
    for (const productId of productsForNeed(need, profile.segment)) {
      if (lines.some((line) => line.productId === productId)) continue;
      if (blocked.some((item) => item.productId === productId)) continue;

      const ids = [...lines.map((line) => line.productId), productId];
      const eligibility = checkProduct(catalogue, productId, profile, ids);
      if (eligibility.eligible) {
        lines.push(toLine(catalogue, profile, productId, { kind: 'NEED', need }));
      } else {
        blocked.push({ ...eligibility, need });
      }
    }
  }

  return { lines, blocked, quote: priceBundle(catalogue, lines) };
}

function chooseConnection(
  catalogue: Catalogue,
  profile: DiscoveryProfile,
): { productId: string | null; blocked: EligibilityResult | null } {
  if (profile.connectivity === 'NONE') return { productId: null, blocked: null };

  const preferences =
    profile.connectivity === 'STANDARD'
      ? STANDARD_CONNECTIVITY[profile.segment ?? 'micro']
      : REQUESTED_CONNECTIVITY[profile.connectivity];

  const results = preferences.map((id) => checkProduct(catalogue, id, profile, [id]));
  const chosen = results.find((result) => result.eligible);
  const first = results[0] ?? null;

  // An owner who asked for something specific hears why they can't have it. On the standard
  // path they only asked to be connected, so stepping down to AirFiber needs no refusal.
  const askedForIt = profile.connectivity !== 'STANDARD' && first !== chosen;
  const report = !chosen || askedForIt ? first : null;
  return { productId: chosen?.productId ?? null, blocked: report };
}

function productsForNeed(need: Need, segment: SegmentCode | null): readonly string[] {
  if (need === 'PHONE_LINES') return segment === 'micro' || segment === null ? ['P07'] : ['P08'];
  if (need === 'SECURITY') {
    if (segment === 'micro' || segment === null) return ['P22'];
    return segment === 'prof' ? ['P20'] : ['P20', 'P21'];
  }
  return PRODUCTS_FOR_NEED[need];
}

function toLine(
  catalogue: Catalogue,
  profile: DiscoveryProfile,
  productId: string,
  reason: LineReason,
): RecommendedLine {
  const quantity = defaultQuantity(getProduct(catalogue, productId), profile, profile.counts);
  return { productId, quantity, reason };
}
