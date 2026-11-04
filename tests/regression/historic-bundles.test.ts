import { describe, expect, it } from 'vitest';
import { getProduct, parseCatalogue } from '@/domain/catalogue/catalogue';
import { checkBundle, type BusinessProfile } from '@/domain/eligibility/eligibility';
import { priceBundle, type BundleLine } from '@/domain/pricing/pricing';
import { gstinStatusFor, readPackCsv } from '../helpers/data-pack';

const catalogue = parseCatalogue(readPackCsv('product_catalogue.csv'));
const registry = new Map(readPackCsv('mock_gstin_registry.csv').map((row) => [row.gstin ?? '', row.status ?? '']));
const activated = readPackCsv('smb_leads.csv').filter((lead) => lead.outcome === 'Activated');

const bundleOf = (lead: Record<string, string>): BundleLine[] =>
  (lead.bundle_products ?? '').split(';').map((item) => {
    const [productId = '', quantity = ''] = item.split('x');
    return { productId, quantity: Number(quantity) };
  });

const profileOf = (lead: Record<string, string>): BusinessProfile => ({
  cityTier: Number(lead.city_tier),
  employeeCount: Number(lead.employee_count),
  numSites: Number(lead.num_sites),
  gstinStatus: gstinStatusFor(lead, registry),
  fibreAvailable: null,
});

const blockersOf = (lead: Record<string, string>) =>
  checkBundle(catalogue, profileOf(lead), bundleOf(lead).map((line) => line.productId)).flatMap((r) => r.blockers);

describe('pricing replays every historic bundle', () => {
  it('has 368 bundles to replay', () => {
    expect(activated).toHaveLength(368);
  });

  it('matches all 368 setup fees exactly', () => {
    const mismatches = activated.filter(
      (lead) => priceBundle(catalogue, bundleOf(lead)).setupTotalInr !== Number(lead.one_time_setup_inr),
    );
    expect(mismatches.map((lead) => lead.lead_id)).toEqual([]);
  });

  it('matches all 368 contract lengths exactly', () => {
    const mismatches = activated.filter(
      (lead) => priceBundle(catalogue, bundleOf(lead)).contractMonths !== Number(lead.contract_months),
    );
    expect(mismatches.map((lead) => lead.lead_id)).toEqual([]);
  });

  it('finds all 368 monthly values inside the catalogue range', () => {
    const outside = activated.filter((lead) => {
      const value = Number(lead.monthly_bundle_value_inr);
      let min = 0;
      let max = 0;
      for (const line of bundleOf(lead)) {
        const product = getProduct(catalogue, line.productId);
        min += product.priceMinInr * line.quantity;
        max += product.priceMaxInr * line.quantity;
      }
      return value < min || value > max;
    });
    expect(outside.map((lead) => lead.lead_id)).toEqual([]);
  });
});

describe('the rules flag the bundles that broke them', () => {
  const flagged = activated.filter((lead) => blockersOf(lead).length > 0);
  const leadsBreaking = (test: (blocker: ReturnType<typeof blockersOf>[number]) => boolean) =>
    activated.filter((lead) => blockersOf(lead).some(test)).length;

  it('flags exactly 56 of 368', () => {
    expect(flagged).toHaveLength(56);
  });

  it('finds 24 on city tier', () => {
    expect(leadsBreaking((b) => b.rule === 'CITY_TIER')).toBe(24);
  });

  it('finds 11 with no GSTIN', () => {
    expect(leadsBreaking((b) => b.rule === 'GSTIN_REQUIRED' && b.actual === 'NONE')).toBe(11);
  });

  it('finds 10 with an inactive GSTIN', () => {
    expect(
      leadsBreaking((b) => b.rule === 'GSTIN_REQUIRED' && (b.actual === 'CANCELLED' || b.actual === 'SUSPENDED')),
    ).toBe(10);
  });

  it('finds 9 on dependencies', () => {
    expect(leadsBreaking((b) => b.rule === 'DEPENDENCY')).toBe(9);
  });

  it('finds 8 on employee count', () => {
    expect(leadsBreaking((b) => b.rule === 'MIN_EMPLOYEES')).toBe(8);
  });

  it('finds none on site count', () => {
    expect(leadsBreaking((b) => b.rule === 'MIN_SITES')).toBe(0);
  });

  it('finds 22 activated on a Cancelled or Suspended GSTIN', () => {
    const inactive = activated.filter((lead) => {
      const status = gstinStatusFor(lead, registry);
      return status === 'CANCELLED' || status === 'SUSPENDED';
    });
    expect(inactive).toHaveLength(22);
  });
});
