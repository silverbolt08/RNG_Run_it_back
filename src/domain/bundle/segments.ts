import type { SegmentCode } from '../catalogue/catalogue';

// In the leads data, every multi-site lead has 3 or more sites and every other lead has 2 or fewer.
const MULTI_SITE_MINIMUM = 3;

const SEGMENT_BY_BUSINESS_TYPE: Readonly<Record<string, SegmentCode>> = {
  bakery: 'micro',
  boutique: 'micro',
  'hardware store': 'micro',
  'kirana store': 'micro',
  'mobile repair shop': 'micro',
  optician: 'micro',
  pharmacy: 'micro',
  salon: 'micro',
  'stationery shop': 'micro',
  'sweet shop': 'micro',
  'architecture studio': 'prof',
  'ca firm': 'prof',
  'coaching centre': 'prof',
  'dental clinic': 'prof',
  'diagnostic lab': 'prof',
  'insurance agency': 'prof',
  'law office': 'prof',
  'physiotherapy clinic': 'prof',
  'real estate agency': 'prof',
  'travel agency': 'prof',
  'apparel retail chain': 'multi',
  'bakery chain': 'multi',
  'budget hotel group': 'multi',
  'electronics retail chain': 'multi',
  'gym chain': 'multi',
  'pharmacy chain': 'multi',
  'pre-school chain': 'multi',
  'restaurant chain': 'multi',
  'auto-parts unit': 'mfg',
  'food processing unit': 'mfg',
  'furniture workshop': 'mfg',
  'packaging unit': 'mfg',
  'plastic moulding unit': 'mfg',
  'printing press': 'mfg',
  'textile unit': 'mfg',
};

// The 22 cities in the leads data. A city outside this list returns null and the advisor asks.
const TIER_BY_CITY: Readonly<Record<string, number>> = {
  ahmedabad: 1,
  bengaluru: 1,
  chennai: 1,
  delhi: 1,
  hyderabad: 1,
  kolkata: 1,
  mumbai: 1,
  pune: 1,
  bhopal: 2,
  coimbatore: 2,
  indore: 2,
  jaipur: 2,
  kochi: 2,
  lucknow: 2,
  ludhiana: 2,
  mysuru: 2,
  nagpur: 2,
  nashik: 2,
  patna: 2,
  surat: 2,
  vadodara: 2,
  visakhapatnam: 2,
};

export const KNOWN_CITIES: readonly string[] = Object.keys(TIER_BY_CITY);

/** A starting guess the advisor confirms with the owner. Segment guides ranking, never eligibility. */
export function inferSegment(businessType: string, numSites: number | null): SegmentCode | null {
  const key = normalise(businessType);
  // Object.hasOwn, so typing "constructor" can't reach an inherited property.
  const segment = Object.hasOwn(SEGMENT_BY_BUSINESS_TYPE, key) ? (SEGMENT_BY_BUSINESS_TYPE[key] ?? null) : null;
  if (segment === 'mfg') return segment;
  return (numSites ?? 1) >= MULTI_SITE_MINIMUM ? 'multi' : segment;
}

export function lookupCityTier(city: string): number | null {
  const key = normalise(city);
  return Object.hasOwn(TIER_BY_CITY, key) ? (TIER_BY_CITY[key] ?? null) : null;
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}
