import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recommendBundle, type Connectivity, type Need } from '@/domain/bundle/recommend-bundle';
import { inferSegment, lookupCityTier } from '@/domain/bundle/segments';
import { parseCatalogue } from '@/domain/catalogue/catalogue';
import { checkBundle } from '@/domain/eligibility/eligibility';
import { gstinStatusFor, readPackCsv, readPackFile, SEGMENT_CODE } from '../helpers/data-pack';

const catalogue = parseCatalogue(readPackCsv('product_catalogue.csv'));
const registry = new Map(readPackCsv('mock_gstin_registry.csv').map((row) => [row.gstin ?? '', row.status ?? '']));
const leads = readPackCsv('smb_leads.csv');

const ALL_NEEDS: Need[] = [
  'UPTIME', 'CUSTOMER_OUTREACH', 'BULK_SMS', 'SECURITY', 'GUEST_WIFI', 'CENTRAL_MANAGEMENT',
  'PHONE_LINES', 'BUSINESS_CALLS', 'TOLL_FREE', 'EMAIL', 'BACKUP', 'WEBSITE', 'POS', 'CCTV',
  'REMOTE_ACCESS', 'FLEET', 'MACHINE_MONITORING',
];
const CONNECTIVITY: Connectivity[] = ['NONE', 'STANDARD', 'HIGH_SPEED', 'DEDICATED', 'DEDICATED_HIGH'];

describe('the test catalogue', () => {
  it('stays identical to the data pack', () => {
    const fixture = readFileSync(fileURLToPath(new URL('../fixtures/product_catalogue.csv', import.meta.url)), 'utf8');
    expect(fixture).toBe(readPackFile('product_catalogue.csv'));
  });
});

describe('segment and tier lookups match all 5,000 leads', () => {
  it('infers every lead segment from business type and sites', () => {
    const wrong = leads.filter(
      (lead) => inferSegment(lead.business_type ?? '', Number(lead.num_sites)) !== SEGMENT_CODE[lead.segment ?? ''],
    );
    expect(wrong).toHaveLength(0);
  });

  it('finds every lead city tier', () => {
    const wrong = leads.filter((lead) => lookupCityTier(lead.city ?? '') !== Number(lead.city_tier));
    expect(wrong).toHaveLength(0);
  });
});

describe('the recommender never breaks a rule', () => {
  // Every lead, every connection choice, with and without fibre, and every need switched on.
  it('passes the eligibility engine for all 5,000 leads in every combination', () => {
    let bundles = 0;
    const violations: string[] = [];

    for (const lead of leads) {
      for (const connectivity of CONNECTIVITY) {
        for (const fibreAvailable of [true, false]) {
          const profile = {
            cityTier: Number(lead.city_tier),
            employeeCount: Number(lead.employee_count),
            numSites: Number(lead.num_sites),
            gstinStatus: gstinStatusFor(lead, registry),
            fibreAvailable,
            segment: SEGMENT_CODE[lead.segment ?? ''] ?? null,
            connectivity,
            needs: ALL_NEEDS,
            counts: {},
          };
          const { lines, quote } = recommendBundle(catalogue, profile);
          const ids = lines.map((line) => line.productId);
          bundles++;

          if (checkBundle(catalogue, profile, ids).some((result) => !result.eligible)) {
            violations.push(`${lead.lead_id} ${connectivity} fibre=${fibreAvailable}`);
          }
          if (!Number.isInteger(quote.monthlyTotalInr) || !Number.isInteger(quote.setupTotalInr)) {
            violations.push(`${lead.lead_id} non-integer price`);
          }
        }
      }
    }

    expect(bundles).toBe(50000);
    expect(violations).toEqual([]);
  });
});
