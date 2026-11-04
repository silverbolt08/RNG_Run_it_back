import { describe, expect, it } from 'vitest';
import { readPackCsv } from '../helpers/data-pack';

const leads = readPackCsv('smb_leads.csv');
const activated = leads.filter((lead) => lead.outcome === 'Activated');
const STAGES = ['Lead', 'Contacted', 'Needs assessed', 'Quote accepted', 'KYC complete', 'Activated'];

const numberOf = (lead: Record<string, string>, column: string) => Number(lead[column]);
const sumOf = (rows: Array<Record<string, string>>, column: string) =>
  rows.reduce((total, lead) => total + numberOf(lead, column), 0);

describe('the numbers in the case reproduce from smb_leads.csv', () => {
  it('has 5,000 leads and 368 activations', () => {
    expect(leads).toHaveLength(5000);
    expect(activated).toHaveLength(368);
    expect((activated.length / leads.length) * 100).toBeCloseTo(7.36, 2);
  });

  // stage_reached holds the last stage, so each stage counts everyone who got at least that far.
  it('reproduces the funnel', () => {
    const reachedAtLeast = STAGES.map(
      (_, index) => leads.filter((lead) => STAGES.indexOf(lead.stage_reached ?? '') >= index).length,
    );
    expect(reachedAtLeast).toEqual([5000, 3406, 1974, 861, 588, 368]);
  });

  it('reproduces acquisition cost as total spend over activations', () => {
    expect(Math.round(sumOf(leads, 'acquisition_cost_inr') / activated.length)).toBe(15053);
  });

  it('shows why averaging over activated leads alone is the wrong number', () => {
    expect(Math.round(sumOf(activated, 'acquisition_cost_inr') / activated.length)).toBe(5385);
  });

  it('reproduces time to activate', () => {
    expect((sumOf(activated, 'days_lead_to_activation') / activated.length).toFixed(1)).toBe('17.6');
  });

  it('reproduces status chases', () => {
    expect((sumOf(activated, 'customer_follow_up_calls') / activated.length).toFixed(2)).toBe('3.01');
  });

  it('reproduces 6-month churn', () => {
    const churned = activated.filter((lead) => lead.churned_within_6_months === 'Y');
    expect(churned).toHaveLength(56);
    expect(((churned.length / activated.length) * 100).toFixed(1)).toBe('15.2');
  });

  it('reproduces the median bundle', () => {
    const values = activated.map((lead) => numberOf(lead, 'monthly_bundle_value_inr')).sort((a, b) => a - b);
    const middle = values.length / 2;
    expect(((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2).toBe(6900);
  });

  it('keeps the literal None as a real value, not a blank', () => {
    expect(leads.filter((lead) => lead.current_internet === 'None')).toHaveLength(124);
    expect(leads.filter((lead) => lead.current_provider === 'None')).toHaveLength(124);
  });
});
