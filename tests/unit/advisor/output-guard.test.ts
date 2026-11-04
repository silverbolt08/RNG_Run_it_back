import { describe, expect, it } from 'vitest';
import { checkReply } from '@/server/llm/output-guard';

const context = {
  values: { MONTHLY: '₹1,297', P01: 'Biz Fibre 100', EMPLOYEES: '4' },
  catalogueNames: ['Biz Fibre 100', 'Managed Firewall', 'Cloud CCTV'],
};

describe('checkReply', () => {
  it('fills in slots with what code decided', () => {
    expect(checkReply('{{P01}} costs {{MONTHLY}} a month, with GST.', context)).toEqual({
      ok: true,
      text: 'Biz Fibre 100 costs ₹1,297 a month, with GST.',
    });
  });

  it('passes a reply in Hindi', () => {
    expect(checkReply('{{P01}} आपकी दुकान के लिए सही रहेगा।', context).ok).toBe(true);
  });

  it.each([
    ['a price typed by the model', 'That is 999 a month', 'NUMERAL'],
    ['Devanagari numerals', 'कीमत ९९९ है', 'NUMERAL'],
    ['Tamil numerals', 'விலை ௯௯ ஆகும்', 'NUMERAL'],
    ['a rupee sign', 'Only ₹ a month', 'MONEY'],
    ['the word rupees', 'a few rupees a month', 'MONEY'],
    ['Hindi money words', 'कुछ रुपये महीना', 'MONEY'],
    ['a percentage off', 'I can take some % off', 'MONEY'],
    ['an amount in words', 'about two thousand a month', 'NUMBER_WORD'],
    ['an amount in Hindi words', 'करीब दो हज़ार', 'NUMBER_WORD'],
    ['romanised Hindi amounts', 'bas do hazaar mahina', 'NUMBER_WORD'],
    ['a promise to waive', 'I will waive the setup fee', 'PROMISE'],
    ['a giveaway', 'You can have it for free', 'PROMISE'],
    ['a typed product name', 'I recommend managed firewall here', 'PRODUCT_NAME'],
    ['a catalogue code', 'Take P15 for that', 'PRODUCT_CODE'],
    ['an invented slot', 'Pay {{DISCOUNT}} now', 'UNKNOWN_SLOT'],
    ['a broken slot', 'Pay {{MONTHLY now', 'UNKNOWN_SLOT'],
    ['a lower-case slot', 'Pay {{monthly}} now', 'UNKNOWN_SLOT'],
    ['an identifier', 'Your number is ABCDE1234F', 'IDENTIFIER'],
    ['nothing at all', '   ', 'EMPTY'],
    ['far too much', 'word '.repeat(400), 'TOO_LONG'],
  ])('refuses %s', (_, text, reason) => {
    expect(checkReply(text, context)).toEqual({ ok: false, reason });
  });
});
