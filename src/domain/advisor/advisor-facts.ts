import { productsForNeed, type Connectivity, type DiscoveryProfile, type Need } from '../bundle/recommend-bundle';
import { inferSegment, lookupCityTier } from '../bundle/segments';
import type { SegmentCode } from '../catalogue/catalogue';
import type { GstinStatus } from '../eligibility/eligibility';
import type { UnitCounts } from '../pricing/pricing';

/**
 * What the advisor knows about the business. Business facts only: no names or identifiers, so this
 * is safe to store and to send to the LLM. `null` means not known yet.
 */
export type AdvisorFacts = {
  businessType: string | null;
  segment: SegmentCode | null;
  /** Kept apart from the segment, so moving down from 3 sites returns to it. */
  segmentGuess: SegmentCode | null;
  city: string | null;
  cityTier: number | null;
  employeeCount: number | null;
  numSites: number | null;
  gstinStatus: GstinStatus | null;
  fibreAvailable: boolean | null;
  connectivity: Connectivity | null;
  needs: Need[];
  /** Products the owner named outright, which get checked even if no stated need leads to them. */
  requestedProducts: string[];
  /** Products the owner said they don't want, which stay out even if a stated need leads to them. */
  excludedProducts: string[];
  /** The owner has said what they need, even if that was "nothing else". */
  needsAnswered: boolean;
  counts: UnitCounts;
  /** Questions the owner chose not to answer. They aren't asked again, and rules needing them block. */
  declined: DeclinableFact[];
};

export type DeclinableFact = 'city' | 'employeeCount' | 'numSites' | 'gstinStatus' | 'fibreAvailable';

export type FactUpdate = Partial<{
  businessType: string;
  /** A guess for a business type the segment table doesn't know. The table wins when it does. */
  segmentGuess: SegmentCode;
  city: string;
  cityTier: number;
  employeeCount: number;
  numSites: number;
  gstinStatus: GstinStatus;
  fibreAvailable: boolean;
  connectivity: Connectivity;
  addNeeds: readonly Need[];
  removeNeeds: readonly Need[];
  addProducts: readonly string[];
  removeProducts: readonly string[];
  needsAnswered: boolean;
  counts: UnitCounts;
  declined: readonly DeclinableFact[];
}>;

/** A value the owner changed. Shown back to them, because it may be a slip rather than a correction. */
export type FactChange = {
  field: 'employeeCount' | 'numSites' | 'gstinStatus' | 'fibreAvailable' | 'city' | 'businessType';
  from: string;
  to: string;
};

export const EMPTY_FACTS: AdvisorFacts = {
  businessType: null,
  segment: null,
  segmentGuess: null,
  city: null,
  cityTier: null,
  employeeCount: null,
  numSites: null,
  gstinStatus: null,
  fibreAvailable: null,
  connectivity: null,
  needs: [],
  requestedProducts: [],
  excludedProducts: [],
  needsAnswered: false,
  counts: {},
  declined: [],
};

/** Merges what the owner just said. The latest statement wins, and any overwritten value is reported. */
export function applyFactUpdate(facts: AdvisorFacts, update: FactUpdate): { facts: AdvisorFacts; changes: FactChange[] } {
  const changes: FactChange[] = [];

  const merge = <T extends string | number | boolean>(
    field: FactChange['field'],
    before: T | null,
    after: T | undefined,
  ): T | null => {
    if (after === undefined) return before;
    if (before !== null && before !== after) changes.push({ field, from: String(before), to: String(after) });
    return after;
  };

  const businessType = merge('businessType', facts.businessType, update.businessType);
  const city = merge('city', facts.city, update.city);
  const employeeCount = merge('employeeCount', facts.employeeCount, update.employeeCount);
  const numSites = merge('numSites', facts.numSites, update.numSites);
  const gstinStatus = merge('gstinStatus', facts.gstinStatus, update.gstinStatus);
  const fibreAvailable = merge('fibreAvailable', facts.fibreAvailable, update.fibreAvailable);

  const cityChanged = city !== facts.city;
  const removed = new Set(update.removeNeeds ?? []);
  const needs = [...new Set([...facts.needs, ...(update.addNeeds ?? [])])].filter((need) => !removed.has(need));

  // Dropping a need drops what was asked for by name to meet it, or it would stay in the bundle.
  const removedProducts = new Set([
    ...(update.removeProducts ?? []),
    ...[...removed].flatMap((need) => productsForNeed(need, facts.segment)),
  ]);
  const requestedProducts = [...new Set([...facts.requestedProducts, ...(update.addProducts ?? [])])].filter(
    (id) => !removedProducts.has(id),
  );
  const added = new Set(update.addProducts ?? []);
  const excludedProducts = [...new Set([...facts.excludedProducts, ...(update.removeProducts ?? [])])].filter((id) => !added.has(id));

  const answered = new Set<DeclinableFact>();
  if (update.city !== undefined || update.cityTier !== undefined) answered.add('city');
  if (update.employeeCount !== undefined) answered.add('employeeCount');
  if (update.numSites !== undefined) answered.add('numSites');
  if (update.gstinStatus !== undefined && update.gstinStatus !== 'UNKNOWN') answered.add('gstinStatus');
  if (update.fibreAvailable !== undefined) answered.add('fibreAvailable');
  const declined = [...new Set([...facts.declined, ...(update.declined ?? [])])].filter((fact) => !answered.has(fact));

  return {
    changes,
    // Spread first to keep the key order, so two sets of facts can be compared as JSON.
    facts: {
      ...facts,
      businessType,
      city,
      cityTier: resolveCityTier(city, cityChanged, facts.cityTier, update.cityTier),
      segment: resolveSegment(businessType, numSites, update.segmentGuess ?? facts.segmentGuess),
      segmentGuess: update.segmentGuess ?? facts.segmentGuess,
      employeeCount,
      numSites,
      gstinStatus,
      fibreAvailable,
      connectivity: update.connectivity ?? facts.connectivity,
      needs,
      requestedProducts,
      excludedProducts,
      needsAnswered: facts.needsAnswered || update.needsAnswered === true || needs.length > 0 || requestedProducts.length > 0,
      counts: { ...facts.counts, ...update.counts },
      declined,
    },
  };
}

// A known city's tier comes from the table, whatever anyone claims about it.
function resolveCityTier(city: string | null, cityChanged: boolean, previous: number | null, stated: number | undefined): number | null {
  const known = city ? lookupCityTier(city) : null;
  if (known !== null) return known;
  if (stated !== undefined) return stated;
  return cityChanged ? null : previous;
}

function resolveSegment(businessType: string | null, numSites: number | null, guess: SegmentCode | null): SegmentCode | null {
  const known = businessType ? inferSegment(businessType, numSites) : null;
  if (known) return known;
  // Matches inferSegment for a type the table doesn't know: 3 or more sites is multi-site.
  if (guess === 'mfg') return guess;
  return (numSites ?? 1) >= 3 ? 'multi' : guess;
}

/** The slots the advisor can ask about, in the order it asks. */
export type AdvisorSlot = 'BUSINESS' | 'CITY' | 'CITY_TIER' | 'EMPLOYEES' | 'SITES' | 'GSTIN' | 'FIBRE' | 'NEEDS';

/**
 * The next question, or null once a recommendation can be made. Only what changes the outcome is
 * asked, and anything the owner declined isn't asked again.
 */
export function nextSlot(facts: AdvisorFacts): AdvisorSlot | null {
  if (!facts.businessType && !facts.segment) return 'BUSINESS';
  if (!isSettled(facts, 'city', facts.city ?? facts.cityTier)) return 'CITY';
  if (facts.cityTier === null && !facts.declined.includes('city')) return 'CITY_TIER';
  if (!isSettled(facts, 'employeeCount', facts.employeeCount)) return 'EMPLOYEES';
  if (!isSettled(facts, 'numSites', facts.numSites)) return 'SITES';
  if (!isSettled(facts, 'gstinStatus', facts.gstinStatus)) return 'GSTIN';
  // An owner who only wants a mobile plan has no use for the fibre question.
  if (facts.connectivity !== 'NONE' && !isSettled(facts, 'fibreAvailable', facts.fibreAvailable)) return 'FIBRE';
  // With no connection and nothing else, there is nothing to recommend yet.
  const wantsNothing = facts.connectivity === 'NONE' && facts.needs.length === 0 && facts.requestedProducts.length === 0;
  if (!facts.needsAnswered || wantsNothing) return 'NEEDS';
  return null;
}

function isSettled(facts: AdvisorFacts, fact: DeclinableFact, value: unknown): boolean {
  return (value !== null && value !== undefined) || facts.declined.includes(fact);
}

/** The engine's input. A fact still unknown stays null, so the rule that needs it blocks. */
export function toDiscoveryProfile(facts: AdvisorFacts): DiscoveryProfile {
  return {
    cityTier: facts.cityTier,
    employeeCount: facts.employeeCount,
    numSites: facts.numSites,
    gstinStatus: facts.gstinStatus ?? 'UNKNOWN',
    fibreAvailable: facts.fibreAvailable,
    segment: facts.segment,
    connectivity: facts.connectivity ?? 'STANDARD',
    needs: facts.needs,
    requestedProducts: facts.requestedProducts,
    excludedProducts: facts.excludedProducts,
    counts: facts.counts,
  };
}
