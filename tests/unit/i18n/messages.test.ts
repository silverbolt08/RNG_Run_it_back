import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import hi from '@/i18n/hi.json';
import { translate } from '@/i18n/messages';

function leaves(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('message catalogues', () => {
  const english = new Map(leaves(en));
  const hindi = new Map(leaves(hi));

  it('has a Hindi string for every English string, and none left over', () => {
    expect([...hindi.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('uses the same placeholders in both languages', () => {
    for (const [key, text] of english) expect(placeholders(hindi.get(key) ?? ''), key).toEqual(placeholders(text));
  });

  it('never names the real operator in the product', () => {
    for (const [key, text] of [...english, ...hindi]) expect(text.toLowerCase(), key).not.toMatch(/airtel|एयरटेल/);
  });
});

describe('translate', () => {
  it('fills in values', () => {
    expect(translate('en', 'quote.contract', { months: '12 months' })).toBe('Contract: 12 months');
  });

  it('falls back to the key rather than blanking a screen', () => {
    expect(translate('hi', 'nothing.here')).toBe('nothing.here');
  });
});
