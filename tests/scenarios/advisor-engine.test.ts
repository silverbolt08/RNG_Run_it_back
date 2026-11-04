import { describe, expect, it } from 'vitest';
import { recommendBundle } from '@/domain/bundle/recommend-bundle';
import { checkBundle } from '@/domain/eligibility/eligibility';
import { loadTestCatalogue } from '../helpers/catalogue';
import { ADVISOR_SCENARIOS, OFF_SCRIPT_SCENARIOS } from './advisor-scenarios';

const catalogue = loadTestCatalogue();

describe('our own advisor scenarios, on the deterministic engine', () => {
  it('has at least the 15 that CLAUDE.md asks for', () => {
    expect(ADVISOR_SCENARIOS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(ADVISOR_SCENARIOS)('$id: $title', ({ profile, expected }) => {
    const result = recommendBundle(catalogue, profile);

    const wanted = expected.products.map((item) => (typeof item === 'string' ? item : item[0]));
    expect(result.lines.map((line) => line.productId).sort()).toEqual([...wanted].sort());

    for (const item of expected.products) {
      if (typeof item === 'string') continue;
      expect(result.lines.find((line) => line.productId === item[0])?.quantity).toBe(item[1]);
    }

    const blocked = expected.blocked ?? [];
    for (const item of blocked) {
      const found = result.blocked.find((entry) => entry.productId === item.productId);
      expect(found, `${item.productId} should be blocked`).toBeDefined();
      expect(found?.blockers.map((blocker) => blocker.rule)).toContain(item.rule);
      if (item.alternatives) expect(found?.alternatives).toEqual(item.alternatives);
    }

    const { quote } = result;
    if (expected.monthlyTotalInr !== undefined) expect(quote.monthlyTotalInr).toBe(expected.monthlyTotalInr);
    if (expected.setupTotalInr !== undefined) expect(quote.setupTotalInr).toBe(expected.setupTotalInr);
    if (expected.contractMonths !== undefined) expect(quote.contractMonths).toBe(expected.contractMonths);
    if (expected.installDays !== undefined) expect(quote.installDays).toBe(expected.installDays);

    const ids = result.lines.map((line) => line.productId);
    expect(checkBundle(catalogue, profile, ids).filter((check) => !check.eligible)).toEqual([]);
  });

  it('gives every scenario a unique ID', () => {
    const ids = ADVISOR_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every off-script scenario at a real one', () => {
    const ids = new Set(ADVISOR_SCENARIOS.map((scenario) => scenario.id));
    for (const scenario of OFF_SCRIPT_SCENARIOS) expect(ids.has(scenario.sameResultAs)).toBe(true);
  });

  it('covers English, Hindi and Hinglish', () => {
    const languages = new Set(ADVISOR_SCENARIOS.map((scenario) => scenario.language));
    expect([...languages].sort()).toEqual(['en', 'hi', 'hinglish']);
  });
});
