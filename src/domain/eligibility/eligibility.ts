import { getProduct, type Catalogue, type Product } from '../catalogue/catalogue';

export type GstinStatus = 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'NONE' | 'UNKNOWN';

/** Null means the owner hasn't told us. A rule that depends on it then blocks, rather than assumes. */
export type BusinessProfile = {
  cityTier: number | null;
  employeeCount: number | null;
  numSites: number | null;
  gstinStatus: GstinStatus;
  fibreAvailable: boolean | null;
};

// Blockers carry values rather than sentences, so the UI can word them in each language.
export type Blocker =
  | { rule: 'CITY_TIER'; required: number[]; actual: number | null; fixable: false }
  | { rule: 'MIN_EMPLOYEES'; required: number; actual: number | null; fixable: false }
  | { rule: 'MIN_SITES'; required: number; actual: number | null; fixable: false }
  | { rule: 'GSTIN_REQUIRED'; required: 'ACTIVE'; actual: GstinStatus; fixable: false }
  | { rule: 'FIBRE_NOT_AVAILABLE'; fixable: false }
  | { rule: 'DEPENDENCY'; required: string[]; actual: string[]; fixable: boolean; eligibleBases: string[] };

export type EligibilityResult = {
  productId: string;
  eligible: boolean;
  blockers: Blocker[];
  alternatives: string[];
};

// Assumption: the catalogue has no fibre flag, but these three are described as fibre.
// Leased lines aren't blocked, since no data says they need the same fibre reach.
const FIBRE_PRODUCT_IDS: ReadonlySet<string> = new Set(['P01', 'P02', 'P03']);

// The tiers the catalogue sells in. A product sold in all of them passes when the tier is unknown.
const SOLD_CITY_TIERS = [1, 2];

/**
 * Nearest alternatives in order of preference. Each inner list is offered as a set, and the
 * first set that passes every check wins. The first entries for P03, P05, P06 and P10 come
 * from the msme-advisor skill. The rest are team assumptions: the closest product that does
 * a similar job and needs less.
 */
const ALTERNATIVE_SETS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  P01: [['P04']],
  P02: [['P04']],
  P03: [['P02'], ['P04']],
  P05: [['P02', 'P09'], ['P04']],
  P06: [['P05'], ['P02', 'P09'], ['P04']],
  P09: [['P07']],
  P10: [['P02'], ['P04']],
  P12: [['P07']],
  P13: [['P07']],
  P14: [['P18']],
  P15: [['P18']],
  P21: [['P20']],
};

/** Checks one product against the profile, reading dependencies from the rest of the bundle. */
export function checkProduct(
  catalogue: Catalogue,
  productId: string,
  profile: BusinessProfile,
  bundleProductIds: readonly string[],
): EligibilityResult {
  const product = getProduct(catalogue, productId);
  const blockers = findBlockers(catalogue, product, profile, bundleProductIds);
  const needsAlternative = blockers.some((blocker) => blocker.rule !== 'DEPENDENCY' || !blocker.fixable);

  return {
    productId,
    eligible: blockers.length === 0,
    blockers,
    alternatives: needsAlternative ? findAlternatives(catalogue, productId, profile, bundleProductIds) : [],
  };
}

/** Returns a result for every product in the bundle, not just the ones that pass. */
export function checkBundle(
  catalogue: Catalogue,
  profile: BusinessProfile,
  productIds: readonly string[],
): EligibilityResult[] {
  return productIds.map((productId) => checkProduct(catalogue, productId, profile, productIds));
}

function findBlockers(
  catalogue: Catalogue,
  product: Product,
  profile: BusinessProfile,
  bundleProductIds: readonly string[],
): Blocker[] {
  const blockers = findProfileBlockers(product, profile);
  const dependency = findDependencyBlocker(catalogue, product, profile, bundleProductIds);
  return dependency ? [...blockers, dependency] : blockers;
}

function findProfileBlockers(product: Product, profile: BusinessProfile): Blocker[] {
  const blockers: Blocker[] = [];
  const { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable } = profile;

  const tierAllowed =
    cityTier === null
      ? SOLD_CITY_TIERS.every((tier) => product.cityTiers.includes(tier))
      : product.cityTiers.includes(cityTier);
  if (!tierAllowed) {
    blockers.push({ rule: 'CITY_TIER', required: product.cityTiers, actual: cityTier, fixable: false });
  }

  if (!meetsMinimum(employeeCount, product.minEmployees)) {
    blockers.push({ rule: 'MIN_EMPLOYEES', required: product.minEmployees, actual: employeeCount, fixable: false });
  }

  if (!meetsMinimum(numSites, product.minSites)) {
    blockers.push({ rule: 'MIN_SITES', required: product.minSites, actual: numSites, fixable: false });
  }

  // Cancelled and Suspended count as no GSTIN.
  if (product.requiresGstin && gstinStatus !== 'ACTIVE') {
    blockers.push({ rule: 'GSTIN_REQUIRED', required: 'ACTIVE', actual: gstinStatus, fixable: false });
  }

  if (fibreAvailable === false && FIBRE_PRODUCT_IDS.has(product.id)) {
    blockers.push({ rule: 'FIBRE_NOT_AVAILABLE', fixable: false });
  }
  return blockers;
}

// Every business has at least one employee and one site, so a minimum of 1 passes when unknown.
function meetsMinimum(actual: number | null, minimum: number): boolean {
  return actual === null ? minimum <= 1 : actual >= minimum;
}

function findDependencyBlocker(
  catalogue: Catalogue,
  product: Product,
  profile: BusinessProfile,
  bundleProductIds: readonly string[],
): Blocker | null {
  const { requiresOneOf } = product;
  if (requiresOneOf.length === 0 || requiresOneOf.some((base) => bundleProductIds.includes(base))) {
    return null;
  }

  const eligibleBases = requiresOneOf.filter(
    (base) => findProfileBlockers(getProduct(catalogue, base), profile).length === 0,
  );
  return {
    rule: 'DEPENDENCY',
    required: requiresOneOf,
    actual: bundleProductIds.filter((id) => id !== product.id),
    fixable: eligibleBases.length > 0,
    eligibleBases,
  };
}

function findAlternatives(
  catalogue: Catalogue,
  productId: string,
  profile: BusinessProfile,
  bundleProductIds: readonly string[],
): string[] {
  const others = bundleProductIds.filter((id) => id !== productId);
  const sets = ALTERNATIVE_SETS[productId] ?? [];
  const firstValid = sets.find((set) =>
    set.every(
      (id) => findBlockers(catalogue, getProduct(catalogue, id), profile, [...others, ...set]).length === 0,
    ),
  );
  return firstValid ? [...firstValid] : [];
}
