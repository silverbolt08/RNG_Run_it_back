import { describe, expect, it } from 'vitest';
import { isSameAddress, isSameName, normaliseName, parseProprietorName, textSimilarity } from '@/domain/kyc/names';

describe('normaliseName', () => {
  it.each([
    ['Trinity Bake House Pvt Ltd', 'trinity bake house'],
    ['Trinity Bake House Private Limited', 'trinity bake house'],
    ['Kaveri Stays LLP', 'kaveri stays'],
    ['Vindhya Tours & Travels', 'vindhya tours and travels'],
    ['  GANESH   woodcraft. ', 'ganesh woodcraft'],
  ])('turns %s into %s', (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });
});

describe('isSameName', () => {
  it('matches across case, punctuation and legal suffixes', () => {
    expect(isSameName('Kaveri Stays LLP', 'KAVERI STAYS')).toBe(true);
  });

  it('tolerates one small OCR slip', () => {
    expect(isSameName('Green Leaf Legal Associates', 'Green Leaf Lega1 Associates')).toBe(true);
  });

  // K07 and K10: the two mismatches planted in the specimens.
  it('rejects a different business', () => {
    expect(isSameName('Shri Physio Clinic', 'Neelgiri Physio Clinic')).toBe(false);
  });

  it('rejects a different person', () => {
    expect(isSameName('Nisha Arora', 'Fatima Menon')).toBe(false);
  });

  it('rejects people sharing a surname', () => {
    expect(isSameName('Neha Shah', 'Pooja Shah')).toBe(false);
  });

  it('never matches blanks', () => {
    expect(isSameName('', '')).toBe(false);
    expect(isSameName('Kaveri', '')).toBe(false);
  });
});

describe('isSameAddress', () => {
  const ADDRESS = 'Shop/Unit 71, Market Yard, Jaipur, Rajasthan - 194057';

  it('ignores spacing and punctuation lost when OCR joins wrapped rows', () => {
    expect(isSameAddress(ADDRESS, 'Shop/Unit 71, Market Yard, Jaipur, Rajasthan- 194057')).toBe(true);
    expect(isSameAddress(ADDRESS, 'Shop/Unit 71, Market Yard, Jaipur, Rajasthan -- 194057')).toBe(true);
  });

  it('rejects a different unit number, even though the text is nearly identical', () => {
    expect(isSameAddress(ADDRESS, 'Shop/Unit 17, Market Yard, Jaipur, Rajasthan - 194057')).toBe(false);
  });

  it('rejects a different PIN', () => {
    expect(isSameAddress(ADDRESS, 'Shop/Unit 71, Market Yard, Jaipur, Rajasthan - 194058')).toBe(false);
  });

  it('rejects a different street with the same numbers', () => {
    expect(isSameAddress(ADDRESS, 'Shop/Unit 71, Lake View Colony, Jaipur, Rajasthan - 194057')).toBe(false);
  });

  it('never matches blanks', () => {
    expect(isSameAddress('', '')).toBe(false);
  });
});

describe('parseProprietorName', () => {
  it('separates the person and the business', () => {
    expect(parseProprietorName('Neha Kaur (Prop. Vindhya Tours & Travels)')).toEqual({
      person: 'Neha Kaur',
      business: 'Vindhya Tours & Travels',
    });
  });

  it('returns null for a company name', () => {
    expect(parseProprietorName('Kaveri Stays LLP')).toBeNull();
  });
});

describe('textSimilarity', () => {
  it('is 1 for identical text and 0 for nothing in common', () => {
    expect(textSimilarity('abc', 'abc')).toBe(1);
    expect(textSimilarity('abc', 'xyz')).toBe(0);
  });

  it('is 0 when both are empty, so blanks never count as a match', () => {
    expect(textSimilarity('', '')).toBe(0);
  });
});
