import { describe, expect, it } from 'vitest';
import { recommendBundle, type DiscoveryProfile } from '@/domain/bundle/recommend-bundle';
import { checkBundle } from '@/domain/eligibility/eligibility';
import { loadTestCatalogue } from '../../../helpers/catalogue';

const catalogue = loadTestCatalogue();

const base: DiscoveryProfile = {
  cityTier: 1,
  employeeCount: 4,
  numSites: 1,
  gstinStatus: 'ACTIVE',
  fibreAvailable: true,
  segment: 'micro',
  connectivity: 'STANDARD',
  needs: [],
  counts: {},
};

const profile = (change: Partial<DiscoveryProfile>): DiscoveryProfile => ({ ...base, ...change });
const ids = (result: ReturnType<typeof recommendBundle>) => result.lines.map((line) => line.productId);
const blockedIds = (result: ReturnType<typeof recommendBundle>) => result.blocked.map((b) => b.productId);

describe('choosing connectivity', () => {
  it('gives micro the entry fibre plan', () => {
    expect(ids(recommendBundle(catalogue, profile({})))).toEqual(['P01']);
  });

  it.each(['prof', 'multi', 'mfg'] as const)('gives %s Fibre 300 by default', (segment) => {
    expect(ids(recommendBundle(catalogue, profile({ segment })))).toEqual(['P02']);
  });

  it('gives AirFiber where fibre does not reach', () => {
    expect(ids(recommendBundle(catalogue, profile({ fibreAvailable: false })))).toEqual(['P04']);
  });

  it('gives 1 Gbps to an eligible business that asks for speed', () => {
    const result = recommendBundle(catalogue, profile({ connectivity: 'HIGH_SPEED', employeeCount: 6 }));
    expect(ids(result)).toEqual(['P03']);
  });

  it('explains and steps down when a tier 2 business asks for 1 Gbps', () => {
    const result = recommendBundle(catalogue, profile({ connectivity: 'HIGH_SPEED', employeeCount: 6, cityTier: 2 }));
    expect(ids(result)).toEqual(['P02']);
    expect(result.blocked[0]).toMatchObject({ productId: 'P03', alternatives: ['P02'] });
    expect(result.blocked[0]?.blockers[0]).toMatchObject({ rule: 'CITY_TIER' });
  });

  it('gives a leased line to an eligible business that needs dedicated bandwidth', () => {
    const result = recommendBundle(catalogue, profile({ connectivity: 'DEDICATED', employeeCount: 40, segment: 'mfg' }));
    expect(ids(result)).toEqual(['P05']);
  });

  it('gives the larger leased line only when asked for', () => {
    const result = recommendBundle(
      catalogue,
      profile({ connectivity: 'DEDICATED_HIGH', employeeCount: 40, segment: 'mfg' }),
    );
    expect(ids(result)).toEqual(['P06']);
  });

  it('explains and steps down when a 6-person office asks for a leased line', () => {
    const result = recommendBundle(catalogue, profile({ connectivity: 'DEDICATED', employeeCount: 6, segment: 'prof' }));
    expect(ids(result)).toEqual(['P02']);
    expect(blockedIds(result)).toEqual(['P05']);
    expect(result.blocked[0]?.alternatives).toEqual(['P02', 'P09']);
  });

  it('adds no broadband for an owner who only wants a mobile plan', () => {
    const result = recommendBundle(catalogue, profile({ connectivity: 'NONE', needs: ['PHONE_LINES'] }));
    expect(ids(result)).toEqual(['P07']);
    expect(result.blocked).toEqual([]);
  });

  it('records the connectivity line as the base, with no need behind it', () => {
    expect(recommendBundle(catalogue, profile({})).lines[0]?.reason).toEqual({ kind: 'CONNECTIVITY' });
  });
});

describe('matching needs to products', () => {
  it('ties each product to the need that caused it', () => {
    const result = recommendBundle(catalogue, profile({ needs: ['POS'] }));
    expect(result.lines[1]).toMatchObject({ productId: 'P19', reason: { kind: 'NEED', need: 'POS' } });
  });

  it.each([
    ['UPTIME', 'P09'],
    ['CUSTOMER_OUTREACH', 'P15'],
    ['BULK_SMS', 'P14'],
    ['GUEST_WIFI', 'P22'],
    ['TOLL_FREE', 'P13'],
    ['EMAIL', 'P16'],
    ['BACKUP', 'P17'],
    ['WEBSITE', 'P18'],
    ['POS', 'P19'],
    ['CCTV', 'P23'],
    ['REMOTE_ACCESS', 'P11'],
    ['FLEET', 'P25'],
    ['BUSINESS_CALLS', 'P12'],
  ] as const)('maps %s to %s', (need, productId) => {
    expect(ids(recommendBundle(catalogue, profile({ needs: [need] })))).toContain(productId);
  });

  it('gives micro the cheaper mobile line and others the fuller one', () => {
    expect(ids(recommendBundle(catalogue, profile({ needs: ['PHONE_LINES'] })))).toContain('P07');
    expect(ids(recommendBundle(catalogue, profile({ needs: ['PHONE_LINES'], segment: 'prof' })))).toContain('P08');
  });

  it('matches security to the segment', () => {
    const security = (change: Partial<DiscoveryProfile>) => ids(recommendBundle(catalogue, profile({ needs: ['SECURITY'], ...change })));
    expect(security({ segment: 'micro' })).toContain('P22');
    expect(security({ segment: 'prof' })).toContain('P20');
    expect(security({ segment: 'mfg', employeeCount: 40 })).toEqual(expect.arrayContaining(['P20', 'P21']));
  });

  it('adds central management for a chain with enough sites and staff', () => {
    const result = recommendBundle(
      catalogue,
      profile({ needs: ['CENTRAL_MANAGEMENT'], segment: 'multi', numSites: 5, employeeCount: 30 }),
    );
    expect(ids(result)).toContain('P10');
  });

  it('does not repeat a product two needs both call for', () => {
    const result = recommendBundle(catalogue, profile({ needs: ['SECURITY', 'GUEST_WIFI'] }));
    expect(ids(result).filter((id) => id === 'P22')).toHaveLength(1);
  });

  it('does not upsell micro past what was asked for', () => {
    expect(ids(recommendBundle(catalogue, profile({ segment: 'micro', needs: [] })))).toEqual(['P01']);
  });
});

describe('quantities', () => {
  it('uses one per site', () => {
    const result = recommendBundle(catalogue, profile({ segment: 'multi', numSites: 8, employeeCount: 40 }));
    expect(result.lines[0]).toMatchObject({ productId: 'P02', quantity: 8 });
  });

  it('uses the counts the owner gave', () => {
    const result = recommendBundle(catalogue, profile({ needs: ['CCTV'], counts: { cameras: 6 } }));
    expect(result.lines.find((l) => l.productId === 'P23')?.quantity).toBe(6);
  });
});

describe('the scenarios the case is likely to probe', () => {
  it('tells a no-GSTIN kirana why it cannot have WhatsApp and what it can have', () => {
    const result = recommendBundle(catalogue, profile({ gstinStatus: 'NONE', needs: ['CUSTOMER_OUTREACH'] }));
    expect(ids(result)).toEqual(['P01']);
    expect(result.blocked[0]).toMatchObject({ productId: 'P15', need: 'CUSTOMER_OUTREACH', alternatives: ['P18'] });
    expect(result.blocked[0]?.blockers[0]).toMatchObject({ rule: 'GSTIN_REQUIRED', actual: 'NONE' });
  });

  it('treats a Cancelled GSTIN the same as none', () => {
    const result = recommendBundle(catalogue, profile({ gstinStatus: 'CANCELLED', needs: ['CUSTOMER_OUTREACH'] }));
    expect(blockedIds(result)).toEqual(['P15']);
    expect(result.blocked[0]?.blockers[0]).toMatchObject({ rule: 'GSTIN_REQUIRED', actual: 'CANCELLED' });
  });

  it('refuses failover on AirFiber for a small site without fibre', () => {
    const result = recommendBundle(
      catalogue,
      profile({ fibreAvailable: false, gstinStatus: 'NONE', needs: ['UPTIME'] }),
    );
    expect(ids(result)).toEqual(['P04']);
    expect(result.blocked[0]).toMatchObject({ productId: 'P09', need: 'UPTIME', alternatives: ['P07'] });
    expect(result.blocked[0]?.blockers[0]).toMatchObject({ rule: 'DEPENDENCY', fixable: false });
  });

  it('refuses SD-WAN for a 2-site chain', () => {
    const result = recommendBundle(
      catalogue,
      profile({ needs: ['CENTRAL_MANAGEMENT'], segment: 'multi', numSites: 2, employeeCount: 20 }),
    );
    expect(ids(result)).toEqual(['P02']);
    expect(result.blocked[0]).toMatchObject({ productId: 'P10', alternatives: ['P02'] });
    expect(result.blocked[0]?.blockers[0]).toMatchObject({ rule: 'MIN_SITES', required: 3, actual: 2 });
  });

  it('offers nothing to a city outside the catalogue and says why', () => {
    const result = recommendBundle(catalogue, profile({ cityTier: 3, needs: ['PHONE_LINES'] }));
    expect(result.lines).toEqual([]);
    expect(blockedIds(result)).toEqual(['P01', 'P07']);
  });

  it('keeps going when an owner will not share their size or GSTIN', () => {
    const result = recommendBundle(
      catalogue,
      profile({ employeeCount: null, numSites: null, gstinStatus: 'UNKNOWN', needs: ['CUSTOMER_OUTREACH', 'POS'] }),
    );
    expect(ids(result)).toEqual(['P01', 'P19']);
    expect(blockedIds(result)).toEqual(['P15']);
  });
});

describe('the result always obeys the rules', () => {
  it('passes the eligibility engine with every need switched on', () => {
    const allNeeds = [
      'UPTIME', 'CUSTOMER_OUTREACH', 'BULK_SMS', 'SECURITY', 'GUEST_WIFI', 'CENTRAL_MANAGEMENT',
      'PHONE_LINES', 'BUSINESS_CALLS', 'TOLL_FREE', 'EMAIL', 'BACKUP', 'WEBSITE', 'POS', 'CCTV',
      'REMOTE_ACCESS', 'FLEET', 'MACHINE_MONITORING',
    ] as const;
    const p = profile({ needs: [...allNeeds], employeeCount: 5, numSites: 2, segment: 'prof' });
    const result = recommendBundle(catalogue, p);
    const checked = checkBundle(catalogue, p, result.lines.map((l) => l.productId));
    expect(checked.filter((c) => !c.eligible)).toEqual([]);
  });

  it('includes a priced quote', () => {
    const result = recommendBundle(catalogue, profile({ needs: ['POS'] }));
    expect(result.quote).toMatchObject({ monthlyTotalInr: 1099 + 3 * 749, setupTotalInr: 7500, contractMonths: 12 });
  });
});
