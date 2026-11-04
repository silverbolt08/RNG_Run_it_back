import { describe, expect, it } from 'vitest';
import {
  checkBundle,
  checkProduct,
  type Blocker,
  type BusinessProfile,
  type GstinStatus,
} from '@/domain/eligibility/eligibility';
import { loadTestCatalogue } from '../../../helpers/catalogue';

const catalogue = loadTestCatalogue();

// Written out by hand from the catalogue, so a wrong parser can't also produce the expectation.
const RULES = [
  { id: 'P01', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P02', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P03', tiers: [1], employees: 5, sites: 1, gstin: true, oneOf: [] },
  { id: 'P04', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P05', tiers: [1, 2], employees: 10, sites: 1, gstin: true, oneOf: [] },
  { id: 'P06', tiers: [1, 2], employees: 25, sites: 1, gstin: true, oneOf: [] },
  { id: 'P07', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P08', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P09', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: ['P01', 'P02', 'P03', 'P05', 'P06'] },
  { id: 'P10', tiers: [1, 2], employees: 10, sites: 3, gstin: true, oneOf: ['P01', 'P02', 'P03', 'P05', 'P06'] },
  { id: 'P11', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: ['P01', 'P02', 'P03'] },
  { id: 'P12', tiers: [1, 2], employees: 3, sites: 1, gstin: true, oneOf: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'] },
  { id: 'P13', tiers: [1, 2], employees: 1, sites: 1, gstin: true, oneOf: [] },
  { id: 'P14', tiers: [1, 2], employees: 1, sites: 1, gstin: true, oneOf: [] },
  { id: 'P15', tiers: [1, 2], employees: 1, sites: 1, gstin: true, oneOf: [] },
  { id: 'P16', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P17', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P18', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P19', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P20', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
  { id: 'P21', tiers: [1, 2], employees: 10, sites: 1, gstin: true, oneOf: ['P01', 'P02', 'P03', 'P05', 'P06'] },
  { id: 'P22', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: ['P01', 'P02', 'P03', 'P04'] },
  { id: 'P23', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'] },
  { id: 'P24', tiers: [1, 2], employees: 10, sites: 1, gstin: true, oneOf: [] },
  { id: 'P25', tiers: [1, 2], employees: 1, sites: 1, gstin: false, oneOf: [] },
] as const;

const OPEN_PROFILE: BusinessProfile = {
  cityTier: 1,
  employeeCount: 100,
  numSites: 10,
  gstinStatus: 'ACTIVE',
  fibreAvailable: null,
};

type Rule = (typeof RULES)[number];

// Includes one valid base, so only the rule under test can block the product.
const bundleFor = (rule: Rule): string[] => [rule.id, ...rule.oneOf.slice(0, 1)];
const check = (rule: Rule, change: Partial<BusinessProfile>) =>
  checkProduct(catalogue, rule.id, { ...OPEN_PROFILE, ...change }, bundleFor(rule));
const rulesOf = (blockers: Blocker[]) => blockers.map((b) => b.rule);

describe('every product passes a business that meets all its rules', () => {
  it.each(RULES)('$id', (rule) => {
    const result = check(rule, {});
    expect(result).toMatchObject({ productId: rule.id, eligible: true, blockers: [] });
  });
});

describe('minimum employees', () => {
  it.each(RULES)('$id at its minimum', (rule) => {
    expect(check(rule, { employeeCount: rule.employees }).eligible).toBe(true);
  });

  it.each(RULES)('$id above its minimum', (rule) => {
    expect(check(rule, { employeeCount: rule.employees + 1 }).eligible).toBe(true);
  });

  it.each(RULES)('$id below its minimum', (rule) => {
    const result = check(rule, { employeeCount: rule.employees - 1 });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContainEqual({
      rule: 'MIN_EMPLOYEES',
      required: rule.employees,
      actual: rule.employees - 1,
      fixable: false,
    });
  });
});

describe('minimum sites', () => {
  it.each(RULES)('$id at its minimum', (rule) => {
    expect(check(rule, { numSites: rule.sites }).eligible).toBe(true);
  });

  it.each(RULES)('$id above its minimum', (rule) => {
    expect(check(rule, { numSites: rule.sites + 1 }).eligible).toBe(true);
  });

  it.each(RULES)('$id below its minimum', (rule) => {
    const result = check(rule, { numSites: rule.sites - 1 });
    expect(result.eligible).toBe(false);
    expect(rulesOf(result.blockers)).toContain('MIN_SITES');
  });
});

describe('city tier', () => {
  it.each(RULES)('$id in each tier it is sold in', (rule) => {
    for (const cityTier of rule.tiers) expect(check(rule, { cityTier }).eligible).toBe(true);
  });

  it('blocks Biz Fibre 1G in tier 2', () => {
    const result = checkProduct(catalogue, 'P03', { ...OPEN_PROFILE, cityTier: 2 }, ['P03']);
    expect(result.blockers).toEqual([{ rule: 'CITY_TIER', required: [1], actual: 2, fixable: false }]);
  });

  it.each(RULES)('$id in a tier outside the catalogue', (rule) => {
    const result = check(rule, { cityTier: 3 });
    expect(result.eligible).toBe(false);
    expect(rulesOf(result.blockers)).toContain('CITY_TIER');
  });
});

describe('GSTIN', () => {
  const REQUIRING = RULES.filter((r) => r.gstin);
  const NOT_REQUIRING = RULES.filter((r) => !r.gstin);
  const NOT_ACTIVE: GstinStatus[] = ['CANCELLED', 'SUSPENDED', 'NONE', 'UNKNOWN'];

  it.each(NOT_ACTIVE)('%s blocks every product that needs a GSTIN', (gstinStatus) => {
    for (const rule of REQUIRING) {
      const result = check(rule, { gstinStatus });
      expect(result.eligible).toBe(false);
      expect(result.blockers).toContainEqual({
        rule: 'GSTIN_REQUIRED',
        required: 'ACTIVE',
        actual: gstinStatus,
        fixable: false,
      });
    }
  });

  it.each(NOT_ACTIVE)('%s does not block products that need no GSTIN', (gstinStatus) => {
    for (const rule of NOT_REQUIRING) expect(check(rule, { gstinStatus }).eligible).toBe(true);
  });

  it('has the expected products on each side of the rule', () => {
    expect(REQUIRING.map((r) => r.id)).toEqual(['P03', 'P05', 'P06', 'P10', 'P12', 'P13', 'P14', 'P15', 'P21', 'P24']);
  });
});

describe('dependencies', () => {
  const DEPENDENT = RULES.filter((r) => r.oneOf.length > 0);
  const ALL_IDS = RULES.map((r) => r.id as string);

  it.each(DEPENDENT)('$id passes with each base it accepts', (rule) => {
    for (const base of rule.oneOf) {
      expect(checkProduct(catalogue, rule.id, OPEN_PROFILE, [rule.id, base]).eligible).toBe(true);
    }
  });

  it.each(DEPENDENT)('$id fails alone', (rule) => {
    const result = checkProduct(catalogue, rule.id, OPEN_PROFILE, [rule.id]);
    expect(result.eligible).toBe(false);
    expect(rulesOf(result.blockers)).toEqual(['DEPENDENCY']);
  });

  it.each(DEPENDENT)('$id fails with every product it does not accept', (rule) => {
    const others = ALL_IDS.filter((id) => id !== rule.id && !(rule.oneOf as readonly string[]).includes(id));
    expect(checkProduct(catalogue, rule.id, OPEN_PROFILE, [rule.id, ...others]).eligible).toBe(false);
  });

  it.each(['P09', 'P10', 'P11', 'P21'])('AirFiber is not a base for %s', (id) => {
    expect(checkProduct(catalogue, id, OPEN_PROFILE, [id, 'P04']).eligible).toBe(false);
  });

  it.each([
    ['P11', 'P05'],
    ['P11', 'P06'],
    ['P22', 'P05'],
    ['P22', 'P06'],
  ])('a leased line is not a base for %s (%s)', (id, base) => {
    expect(checkProduct(catalogue, id, OPEN_PROFILE, [id, base]).eligible).toBe(false);
  });

  it('marks a missing base as fixable and names the bases this business could add', () => {
    const profile = { ...OPEN_PROFILE, employeeCount: 3, gstinStatus: 'NONE' as const };
    const result = checkProduct(catalogue, 'P09', profile, ['P09', 'P04']);
    expect(result.blockers).toEqual([
      {
        rule: 'DEPENDENCY',
        required: ['P01', 'P02', 'P03', 'P05', 'P06'],
        actual: ['P04'],
        fixable: true,
        eligibleBases: ['P01', 'P02'],
      },
    ]);
  });
});

describe('fibre availability', () => {
  const NO_FIBRE: Partial<BusinessProfile> = { fibreAvailable: false };

  it.each(['P01', 'P02', 'P03'])('blocks %s where fibre does not reach', (id) => {
    const result = checkProduct(catalogue, id, { ...OPEN_PROFILE, ...NO_FIBRE }, [id]);
    expect(result.blockers).toEqual([{ rule: 'FIBRE_NOT_AVAILABLE', fixable: false }]);
    expect(result.alternatives).toEqual(['P04']);
  });

  it('leaves AirFiber available', () => {
    expect(checkProduct(catalogue, 'P04', { ...OPEN_PROFILE, ...NO_FIBRE }, ['P04']).eligible).toBe(true);
  });

  it.each([true, null])('does not block fibre when availability is %s', (fibreAvailable) => {
    expect(checkProduct(catalogue, 'P01', { ...OPEN_PROFILE, fibreAvailable }, ['P01']).eligible).toBe(true);
  });

  it('means a small site without fibre cannot get failover at all', () => {
    const profile = { ...OPEN_PROFILE, ...NO_FIBRE, employeeCount: 3, gstinStatus: 'NONE' as const };
    const result = checkProduct(catalogue, 'P09', profile, ['P09', 'P04']);
    expect(result.blockers[0]).toMatchObject({ rule: 'DEPENDENCY', fixable: false, eligibleBases: [] });
  });
});

describe('facts the owner did not share', () => {
  const UNKNOWN: BusinessProfile = {
    cityTier: null,
    employeeCount: null,
    numSites: null,
    gstinStatus: 'UNKNOWN',
    fibreAvailable: null,
  };

  it('still allows products with no size, GSTIN or tier limit', () => {
    expect(checkProduct(catalogue, 'P07', UNKNOWN, ['P07']).eligible).toBe(true);
  });

  it('blocks a size-limited product rather than assuming', () => {
    const result = checkProduct(catalogue, 'P05', UNKNOWN, ['P05']);
    expect(result.blockers).toContainEqual({ rule: 'MIN_EMPLOYEES', required: 10, actual: null, fixable: false });
  });

  it('blocks a multi-site product rather than assuming', () => {
    const result = checkProduct(catalogue, 'P10', UNKNOWN, ['P10', 'P01']);
    expect(result.blockers).toContainEqual({ rule: 'MIN_SITES', required: 3, actual: null, fixable: false });
  });

  it('blocks a tier-limited product rather than assuming', () => {
    const result = checkProduct(catalogue, 'P03', UNKNOWN, ['P03']);
    expect(result.blockers).toContainEqual({ rule: 'CITY_TIER', required: [1], actual: null, fixable: false });
  });
});

describe('every blocker is reported, not just the first', () => {
  it('lists all the rules a product breaks', () => {
    const profile: BusinessProfile = {
      cityTier: 2,
      employeeCount: 2,
      numSites: 1,
      gstinStatus: 'NONE',
      fibreAvailable: null,
    };
    expect(rulesOf(checkProduct(catalogue, 'P03', profile, ['P03']).blockers)).toEqual([
      'CITY_TIER',
      'MIN_EMPLOYEES',
      'GSTIN_REQUIRED',
    ]);
  });
});

describe('alternatives', () => {
  const small: BusinessProfile = { ...OPEN_PROFILE, employeeCount: 6, numSites: 1 };

  it('offers Fibre 300 to a tier 2 business asking for 1 Gbps', () => {
    expect(checkProduct(catalogue, 'P03', { ...OPEN_PROFILE, cityTier: 2 }, ['P03']).alternatives).toEqual(['P02']);
  });

  it('offers Fibre 300 with failover to a 6-person office asking for a leased line', () => {
    expect(checkProduct(catalogue, 'P05', small, ['P05']).alternatives).toEqual(['P02', 'P09']);
  });

  it('offers the smaller leased line when a business can have one', () => {
    const profile = { ...OPEN_PROFILE, employeeCount: 12 };
    expect(checkProduct(catalogue, 'P06', profile, ['P06']).alternatives).toEqual(['P05']);
  });

  it('falls back when the smaller leased line is not allowed either', () => {
    expect(checkProduct(catalogue, 'P06', small, ['P06']).alternatives).toEqual(['P02', 'P09']);
  });

  it('offers Fibre 300 per site to a 2-site chain asking for SD-WAN', () => {
    const profile = { ...OPEN_PROFILE, numSites: 2 };
    expect(checkProduct(catalogue, 'P10', profile, ['P10', 'P01']).alternatives).toEqual(['P02']);
  });

  it('offers a website to a business that cannot have WhatsApp without a GSTIN', () => {
    const profile = { ...OPEN_PROFILE, gstinStatus: 'NONE' as const };
    expect(checkProduct(catalogue, 'P15', profile, ['P15']).alternatives).toEqual(['P18']);
  });

  it('only offers alternatives that pass the same checks', () => {
    const noFibre = { ...small, fibreAvailable: false };
    const alternatives = checkProduct(catalogue, 'P05', noFibre, ['P05']).alternatives;
    for (const id of alternatives) {
      expect(checkProduct(catalogue, id, noFibre, alternatives).eligible).toBe(true);
    }
    expect(alternatives).not.toContain('P02');
  });

  it('offers nothing when the product is eligible', () => {
    expect(checkProduct(catalogue, 'P01', OPEN_PROFILE, ['P01']).alternatives).toEqual([]);
  });

  it('offers nothing when only a base is missing, since the blocker already names the fix', () => {
    expect(checkProduct(catalogue, 'P09', OPEN_PROFILE, ['P09']).alternatives).toEqual([]);
  });
});

describe('checkBundle', () => {
  it('returns one result for every product in the bundle', () => {
    const results = checkBundle(catalogue, OPEN_PROFILE, ['P01', 'P09', 'P15']);
    expect(results.map((r) => r.productId)).toEqual(['P01', 'P09', 'P15']);
    expect(results.every((r) => r.eligible)).toBe(true);
  });

  it('reads a dependency from the rest of the bundle', () => {
    const [, failover] = checkBundle(catalogue, OPEN_PROFILE, ['P04', 'P09']);
    expect(failover?.eligible).toBe(false);
  });

  it('throws for a product outside the catalogue', () => {
    expect(() => checkBundle(catalogue, OPEN_PROFILE, ['P99'])).toThrow(/P99/);
  });
});
