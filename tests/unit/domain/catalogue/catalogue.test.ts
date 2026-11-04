import { describe, expect, it } from 'vitest';
import { getProduct, parseCatalogue } from '@/domain/catalogue/catalogue';
import { loadTestCatalogue } from '../../../helpers/catalogue';

const catalogue = loadTestCatalogue();

const VALID_ROW = {
  product_id: 'P01',
  category: 'Connectivity',
  product_name: 'Biz Fibre 100',
  description: 'Fibre',
  unit: 'per site',
  price_min_inr_per_month: '999',
  price_max_inr_per_month: '1199',
  one_time_setup_inr: '0',
  min_contract_months: '12',
  available_city_tiers: '1;2',
  min_employees: '1',
  min_sites: '1',
  requires_gstin: 'N',
  requires_one_of: '',
  typical_install_days: '5',
  target_segments: 'micro;prof',
};

describe('parseCatalogue', () => {
  it('reads all 25 products', () => {
    expect(catalogue.products).toHaveLength(25);
  });

  it('reads prices, fees and timings as numbers', () => {
    expect(getProduct(catalogue, 'P05')).toMatchObject({
      name: 'Internet Leased Line 20',
      unit: 'per site',
      priceMinInr: 8000,
      priceMaxInr: 12000,
      setupInr: 10000,
      minContractMonths: 12,
      installDays: 21,
    });
  });

  it('reads eligibility rules', () => {
    expect(getProduct(catalogue, 'P03')).toMatchObject({
      cityTiers: [1],
      minEmployees: 5,
      minSites: 1,
      requiresGstin: true,
      requiresOneOf: [],
    });
  });

  it('splits dependencies on the pipe character', () => {
    expect(getProduct(catalogue, 'P09').requiresOneOf).toEqual(['P01', 'P02', 'P03', 'P05', 'P06']);
  });

  it('splits target segments on the semicolon', () => {
    expect(getProduct(catalogue, 'P05').targetSegments).toEqual(['mfg', 'multi']);
  });

  it.each([
    ['a non-numeric price', { price_min_inr_per_month: 'abc' }],
    ['a blank price', { price_max_inr_per_month: '' }],
    ['a price range the wrong way round', { price_min_inr_per_month: '2000' }],
    ['an unknown GSTIN flag', { requires_gstin: 'Maybe' }],
    ['an unknown tier', { available_city_tiers: '1;x' }],
    ['no tiers', { available_city_tiers: '' }],
    ['an unknown segment', { target_segments: 'giant' }],
  ])('rejects %s', (_name, change) => {
    expect(() => parseCatalogue([{ ...VALID_ROW, ...change }])).toThrow();
  });

  it('rejects duplicate product IDs', () => {
    expect(() => parseCatalogue([VALID_ROW, VALID_ROW])).toThrow(/duplicate/i);
  });

  it('rejects a dependency on a product that does not exist', () => {
    expect(() => parseCatalogue([{ ...VALID_ROW, requires_one_of: 'P99' }])).toThrow(/P99/);
  });
});

describe('getProduct', () => {
  it('throws for an unknown product', () => {
    expect(() => getProduct(catalogue, 'P99')).toThrow(/P99/);
  });
});
