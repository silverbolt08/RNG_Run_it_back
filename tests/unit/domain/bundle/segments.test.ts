import { describe, expect, it } from 'vitest';
import { inferSegment, lookupCityTier } from '@/domain/bundle/segments';

describe('inferSegment', () => {
  it.each([
    ['Kirana store', 'micro'],
    ['Salon', 'micro'],
    ['Pharmacy', 'micro'],
    ['Dental clinic', 'prof'],
    ['CA firm', 'prof'],
    ['Coaching centre', 'prof'],
    ['Restaurant chain', 'multi'],
    ['Pharmacy chain', 'multi'],
    ['Textile unit', 'mfg'],
    ['Auto-parts unit', 'mfg'],
  ] as const)('maps %s to %s', (businessType, expected) => {
    expect(inferSegment(businessType, 1)).toBe(expected);
  });

  it('treats 3 or more sites as multi-site, whatever the type', () => {
    expect(inferSegment('Bakery', 3)).toBe('multi');
    expect(inferSegment('Dental clinic', 5)).toBe('multi');
  });

  it('keeps a type below 3 sites in its own segment', () => {
    expect(inferSegment('Dental clinic', 2)).toBe('prof');
  });

  it('leaves manufacturers as manufacturers at any size', () => {
    expect(inferSegment('Textile unit', 4)).toBe('mfg');
  });

  it('returns null for a type we do not know, so the advisor asks', () => {
    expect(inferSegment('Spaceport', 1)).toBeNull();
  });

  it('still recognises a chain from its site count when the type is unknown', () => {
    expect(inferSegment('Spaceport', 4)).toBe('multi');
  });

  it('assumes one site when the count is unknown', () => {
    expect(inferSegment('Salon', null)).toBe('micro');
  });

  it('ignores case and surrounding spaces', () => {
    expect(inferSegment('  kirana STORE ', 1)).toBe('micro');
  });
});

describe('lookupCityTier', () => {
  it.each([
    ['Mumbai', 1],
    ['Delhi', 1],
    ['Nagpur', 2],
    ['Kochi', 2],
  ])('finds %s in tier %i', (city, tier) => {
    expect(lookupCityTier(city)).toBe(tier);
  });

  it('ignores case and surrounding spaces', () => {
    expect(lookupCityTier(' mumbai ')).toBe(1);
  });

  it('returns null for a city outside the data, so the advisor asks', () => {
    expect(lookupCityTier('Gangtok')).toBeNull();
  });
});
