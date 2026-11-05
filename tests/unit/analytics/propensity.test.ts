import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { propensityScore, type PropensityModel } from '@/domain/analytics/propensity';

const model = JSON.parse(readFileSync('analytics/output/propensity.json', 'utf8')).model as PropensityModel;

const lead = (categories: Record<string, string>, numbers: Record<string, number> = {}) => ({ categories, numbers });

describe('propensityScore', () => {
  it('turns the intercept into the score for a lead at the reference values', () => {
    const score = propensityScore({ intercept: 0, weights: {}, numeric_scaling: {} }, lead({}));
    expect(score).toBe(0.5);
  });

  it('scales numbers the way the model was trained', () => {
    const toy: PropensityModel = { intercept: 0, weights: { size: 1 }, numeric_scaling: { size: { mean: 10, scale: 5 } } };
    expect(propensityScore(toy, lead({}, { size: 10 }))).toBe(0.5);
    expect(propensityScore(toy, lead({}, { size: 15 }))).toBeCloseTo(0.7311, 4);
  });

  it('ranks a referred lead with a GSTIN above a WhatsApp lead without one', () => {
    const strong = propensityScore(model, lead({ lead_source: 'Referral', has_gstin: 'Y', segment: 'Professional offices' }));
    const weak = propensityScore(model, lead({ lead_source: 'WhatsApp campaign', has_gstin: 'N', segment: 'Micro retail & services' }));
    expect(strong).toBeGreaterThan(weak);
  });

  it('ignores a value the model has never seen', () => {
    const base = propensityScore(model, lead({}));
    expect(propensityScore(model, lead({ lead_source: 'Carrier pigeon' }))).toBe(base);
  });

  it('holds no weight on language or state', () => {
    expect(Object.keys(model.weights).some((key) => /language|^state/.test(key))).toBe(false);
  });
});
