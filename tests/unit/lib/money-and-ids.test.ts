import { describe, expect, it } from 'vitest';
import { newPublicId, newRequestId } from '@/lib/ids';
import { formatInr } from '@/lib/money';

describe('formatInr', () => {
  it.each([
    [0, '₹0'],
    [999, '₹999'],
    [28080, '₹28,080'],
    [128080, '₹1,28,080'],
  ])('formats %i with Indian digit grouping', (amount, expected) => {
    expect(formatInr(amount)).toBe(expected);
  });

  it('refuses a fractional amount, because money is whole rupees', () => {
    expect(() => formatInr(137.5)).toThrow(RangeError);
  });
});

describe('public and request IDs', () => {
  it('prefixes an ID and makes it unguessable', () => {
    const id = newPublicId('qt');
    expect(id).toMatch(/^qt_[A-Za-z0-9_-]{22}$/);
  });

  it('never repeats an ID', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newPublicId('qt')));
    expect(ids.size).toBe(1000);
  });

  it('builds request IDs in the same random form', () => {
    expect(newRequestId()).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
  });
});
