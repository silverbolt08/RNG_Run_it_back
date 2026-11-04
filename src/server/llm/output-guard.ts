import { containsIdentifier } from '../../lib/redact';

/**
 * The LLM writes sentences with slots such as {{MONTHLY}}, and code fills them in. So every price,
 * count and product name the owner reads comes from code, and this guard refuses a reply that
 * tried to say one itself, in any script.
 */
export type GuardContext = {
  /** The slots this reply may use, and what code will put in them. */
  values: Readonly<Record<string, string>>;
  /** Every product name in the catalogue, none of which the model may type. */
  catalogueNames: readonly string[];
};

export type GuardFailure =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'UNKNOWN_SLOT'
  | 'NUMERAL'
  | 'MONEY'
  | 'NUMBER_WORD'
  | 'PROMISE'
  | 'PRODUCT_NAME'
  | 'PRODUCT_CODE'
  | 'IDENTIFIER';

export type GuardResult = { ok: true; text: string } | { ok: false; reason: GuardFailure };

const MAX_REPLY_CHARS = 1200;
const SLOT = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

// \p{Nd} is a digit in any script, so Devanagari, Tamil and the rest are all covered.
const NUMERAL = /\p{Nd}/u;
const MONEY = /₹|\brs\.?\b|\binr\b|rupee|rupay|रुपय|रुपए|रुपये|रू\.|\$|%|percent|per cent|प्रतिशत|फीसदी/iu;
// Words for amounts. "one" and "two" are left out, since ordinary sentences need them.
const NUMBER_WORD = /\b(hundred|thousand|lakh|lac|crore|sau|hazaar|hazar)\b|सौ|हज़ार|हजार|लाख|करोड़/iu;
const PROMISE = /\b(for free|free of charge|no charge|waive|waived|guarantee|guaranteed|muft)\b|मुफ़्त|मुफ्त|गारंटी/iu;
const PRODUCT_CODE = /\bP\d{2}\b/;

export function checkReply(raw: string, context: GuardContext): GuardResult {
  const text = raw.trim();
  if (text === '') return { ok: false, reason: 'EMPTY' };
  if (text.length > MAX_REPLY_CHARS) return { ok: false, reason: 'TOO_LONG' };

  for (const match of text.matchAll(SLOT)) {
    if (context.values[match[1] ?? ''] === undefined) return { ok: false, reason: 'UNKNOWN_SLOT' };
  }

  // What's left once slots are gone is what the model wrote itself.
  const own = text.replace(SLOT, ' ');
  if (own.includes('{{') || own.includes('}}')) return { ok: false, reason: 'UNKNOWN_SLOT' };
  if (containsIdentifier(own)) return { ok: false, reason: 'IDENTIFIER' };
  if (PRODUCT_CODE.test(own)) return { ok: false, reason: 'PRODUCT_CODE' };
  if (NUMERAL.test(own)) return { ok: false, reason: 'NUMERAL' };
  if (MONEY.test(own)) return { ok: false, reason: 'MONEY' };
  if (NUMBER_WORD.test(own)) return { ok: false, reason: 'NUMBER_WORD' };
  if (PROMISE.test(own)) return { ok: false, reason: 'PROMISE' };

  const lower = own.toLowerCase();
  if (context.catalogueNames.some((name) => lower.includes(name.toLowerCase()))) {
    return { ok: false, reason: 'PRODUCT_NAME' };
  }

  return { ok: true, text: fillSlots(text, context.values) };
}

export function fillSlots(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(SLOT, (_, key: string) => values[key] ?? '');
}
