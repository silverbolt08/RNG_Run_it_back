import { describe, expect, it } from 'vitest';
import { addProduct, removeProduct, revalidateBundle } from '@/domain/bundle/bundle-changes';
import type { BusinessProfile } from '@/domain/eligibility/eligibility';
import { loadTestCatalogue } from '../../../helpers/catalogue';

const catalogue = loadTestCatalogue();

const PROFILE: BusinessProfile = {
  cityTier: 1,
  employeeCount: 12,
  numSites: 1,
  gstinStatus: 'ACTIVE',
  fibreAvailable: null,
};

const lines = (...ids: string[]) => ids.map((productId) => ({ productId, quantity: 1 }));
const ids = (bundle: ReadonlyArray<{ productId: string }>) => bundle.map((line) => line.productId);

describe('removeProduct', () => {
  it('removes a product nothing depends on', () => {
    const result = removeProduct(catalogue, lines('P01', 'P07'), 'P07');
    expect(ids(result.lines)).toEqual(['P01']);
    expect(result.stranded).toEqual([]);
  });

  it('warns about and removes everything that loses its base', () => {
    const result = removeProduct(catalogue, lines('P01', 'P09', 'P11', 'P22', 'P23', 'P07'), 'P01');
    expect(ids(result.lines)).toEqual(['P07']);
    expect(result.stranded).toEqual([
      { productId: 'P09', requiredOneOf: ['P01', 'P02', 'P03', 'P05', 'P06'] },
      { productId: 'P11', requiredOneOf: ['P01', 'P02', 'P03'] },
      { productId: 'P22', requiredOneOf: ['P01', 'P02', 'P03', 'P04'] },
      { productId: 'P23', requiredOneOf: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'] },
    ]);
  });

  it('keeps dependents when another valid base remains', () => {
    const result = removeProduct(catalogue, lines('P01', 'P02', 'P09'), 'P01');
    expect(ids(result.lines)).toEqual(['P02', 'P09']);
    expect(result.stranded).toEqual([]);
  });

  it('strands only what the remaining base cannot support', () => {
    const result = removeProduct(catalogue, lines('P01', 'P04', 'P09', 'P22'), 'P01');
    expect(ids(result.lines)).toEqual(['P04', 'P22']);
    expect(result.stranded.map((s) => s.productId)).toEqual(['P09']);
  });

  it('keeps quantities on the lines that stay', () => {
    const result = removeProduct(catalogue, [{ productId: 'P01', quantity: 3 }, { productId: 'P07', quantity: 5 }], 'P01');
    expect(result.lines).toEqual([{ productId: 'P07', quantity: 5 }]);
  });

  it('ignores a product that is not in the bundle', () => {
    const result = removeProduct(catalogue, lines('P01'), 'P07');
    expect(ids(result.lines)).toEqual(['P01']);
  });
});

describe('addProduct', () => {
  it('adds an eligible product', () => {
    const result = addProduct(catalogue, PROFILE, lines('P01'), { productId: 'P09', quantity: 1 });
    expect(result.status).toBe('ADDED');
    expect(ids(result.lines)).toEqual(['P01', 'P09']);
  });

  it('refuses an ineligible product and leaves the bundle unchanged', () => {
    const profile = { ...PROFILE, gstinStatus: 'CANCELLED' as const };
    const result = addProduct(catalogue, profile, lines('P01'), { productId: 'P15', quantity: 1 });
    expect(result.status).toBe('BLOCKED');
    expect(ids(result.lines)).toEqual(['P01']);
    if (result.status === 'BLOCKED') {
      expect(result.eligibility.blockers[0]?.rule).toBe('GSTIN_REQUIRED');
      expect(result.eligibility.alternatives).toEqual(['P18']);
    }
  });

  it('refuses failover on AirFiber, and names the bases that would allow it', () => {
    const result = addProduct(catalogue, PROFILE, lines('P04'), { productId: 'P09', quantity: 1 });
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.eligibility.blockers[0]).toMatchObject({ rule: 'DEPENDENCY', fixable: true });
    }
  });

  it('updates the quantity when the product is already in the bundle', () => {
    const result = addProduct(catalogue, PROFILE, lines('P01'), { productId: 'P01', quantity: 4 });
    expect(result.lines).toEqual([{ productId: 'P01', quantity: 4 }]);
  });
});

describe('revalidateBundle', () => {
  it('keeps everything when the profile still fits', () => {
    const result = revalidateBundle(catalogue, PROFILE, lines('P01', 'P15'));
    expect(ids(result.lines)).toEqual(['P01', 'P15']);
    expect(result.dropped).toEqual([]);
  });

  // KYC can find a GSTIN is Cancelled after the owner has accepted a quote, as with K01.
  it('drops GSTIN products when KYC finds the GSTIN Cancelled', () => {
    const profile = { ...PROFILE, gstinStatus: 'CANCELLED' as const };
    const result = revalidateBundle(catalogue, profile, lines('P01', 'P07', 'P14', 'P15'));
    expect(ids(result.lines)).toEqual(['P01', 'P07']);
    expect(result.dropped.map((d) => d.productId)).toEqual(['P14', 'P15']);
    expect(result.dropped[0]?.blockers[0]?.rule).toBe('GSTIN_REQUIRED');
    expect(result.dropped[1]?.alternatives).toEqual(['P18']);
  });

  it('also drops dependents of a base it had to remove', () => {
    const profile = { ...PROFILE, gstinStatus: 'SUSPENDED' as const };
    const result = revalidateBundle(catalogue, profile, lines('P03', 'P09', 'P07'));
    expect(ids(result.lines)).toEqual(['P07']);
    expect(result.dropped.map((d) => d.productId)).toEqual(['P03', 'P09']);
    expect(result.dropped[1]?.blockers[0]?.rule).toBe('DEPENDENCY');
  });

  it('reacts to a corrected size', () => {
    const profile = { ...PROFILE, employeeCount: 6 };
    const result = revalidateBundle(catalogue, profile, lines('P05', 'P07'));
    expect(ids(result.lines)).toEqual(['P07']);
    expect(result.dropped[0]?.alternatives).toEqual(['P02', 'P09']);
  });
});
