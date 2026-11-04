import { describe, expect, it } from 'vitest';
import { recommendBundle, type Connectivity, type Need } from '@/domain/bundle/recommend-bundle';
import { parseCatalogue, type SegmentCode } from '@/domain/catalogue/catalogue';
import { checkBundle, type BusinessProfile } from '@/domain/eligibility/eligibility';
import { gstinStatusFor, readPackCsv, SEGMENT_CODE } from '../helpers/data-pack';

const catalogue = parseCatalogue(readPackCsv('product_catalogue.csv'));
const registry = new Map(readPackCsv('mock_gstin_registry.csv').map((row) => [row.gstin ?? '', row.status ?? '']));
const activated = readPackCsv('smb_leads.csv').filter((lead) => lead.outcome === 'Activated');

const NEED_FOR_PRODUCT: Readonly<Record<string, Need>> = {
  P07: 'PHONE_LINES',
  P08: 'PHONE_LINES',
  P09: 'UPTIME',
  P10: 'CENTRAL_MANAGEMENT',
  P11: 'REMOTE_ACCESS',
  P12: 'BUSINESS_CALLS',
  P13: 'TOLL_FREE',
  P14: 'BULK_SMS',
  P15: 'CUSTOMER_OUTREACH',
  P16: 'EMAIL',
  P17: 'BACKUP',
  P18: 'WEBSITE',
  P19: 'POS',
  P20: 'SECURITY',
  P21: 'SECURITY',
  P22: 'GUEST_WIFI',
  P23: 'CCTV',
  P24: 'MACHINE_MONITORING',
  P25: 'FLEET',
};

const productIdsOf = (lead: Record<string, string>) =>
  (lead.bundle_products ?? '').split(';').map((item) => item.split('x')[0] ?? '');

const connectivityOf = (ids: readonly string[]): Connectivity => {
  if (ids.includes('P06')) return 'DEDICATED_HIGH';
  if (ids.includes('P05')) return 'DEDICATED';
  if (ids.includes('P03')) return 'HIGH_SPEED';
  return ids.some((id) => ['P01', 'P02', 'P04'].includes(id)) ? 'STANDARD' : 'NONE';
};

function replay(lead: Record<string, string>) {
  const ids = productIdsOf(lead);
  const profile: BusinessProfile & { segment: SegmentCode | null } = {
    cityTier: Number(lead.city_tier),
    employeeCount: Number(lead.employee_count),
    numSites: Number(lead.num_sites),
    gstinStatus: gstinStatusFor(lead, registry),
    fibreAvailable: ids.includes('P04') && !ids.includes('P01') && !ids.includes('P02') ? false : null,
    segment: SEGMENT_CODE[lead.segment ?? ''] ?? null,
  };
  const needs = [...new Set(ids.flatMap((id) => NEED_FOR_PRODUCT[id] ?? []))];
  return {
    profile,
    result: recommendBundle(catalogue, { ...profile, connectivity: connectivityOf(ids), needs, counts: {} }),
  };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Historic bundles are a sanity check only. 56 of them broke a rule, so these are filtered out.
 * Each customer's needs are read from what they bought, then priced with our default quantities.
 */
describe('recommended prices stay near what similar customers actually paid', () => {
  const clean = activated.filter((lead) => {
    const profile = replay(lead).profile;
    return checkBundle(catalogue, profile, productIdsOf(lead)).every((result) => result.eligible);
  });

  it('replays the 312 bundles that broke no rule', () => {
    expect(clean).toHaveLength(312);
  });

  it.each(['micro', 'prof', 'multi', 'mfg'] as const)('%s median is within 40%% of history', (segment) => {
    const group = clean.filter((lead) => SEGMENT_CODE[lead.segment ?? ''] === segment);
    const recommended = median(group.map((lead) => replay(lead).result.quote.monthlyTotalInr));
    const actual = median(group.map((lead) => Number(lead.monthly_bundle_value_inr)));
    expect(recommended / actual).toBeGreaterThan(0.6);
    expect(recommended / actual).toBeLessThan(1.4);
  });

  it('recommends what the customer bought at least 85% of the time', () => {
    let bought = 0;
    let matched = 0;
    for (const lead of clean) {
      const recommended = new Set(replay(lead).result.lines.map((line) => line.productId));
      for (const id of productIdsOf(lead)) {
        bought++;
        if (recommended.has(id)) matched++;
      }
    }
    expect(matched / bought).toBeGreaterThan(0.85);
  });
});
