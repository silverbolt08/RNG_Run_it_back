import { containsIdentifier } from '../../lib/redact';

/**
 * The LLM writes sentences with slots such as {{MONTHLY}}, and code fills them in. So every price,
 * count and product name the owner reads comes from code, and this guard refuses a reply that
 * tried to say one itself. Numerals are caught in every script. Words for amounts and promises are
 * covered in English, Hindi and romanised Hindi, the languages our screens and templates support.
 */
export type GuardContext = {
  /** The slots this reply may use, and what code will put in them. */
  values: Readonly<Record<string, string>>;
  /** Every product name in the catalogue, none of which the model may type. */
  catalogueNames: readonly string[];
  /** What the model was asked to say. Some words are fine only if the brief raised them. */
  brief?: string;
};

export type GuardFailure =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'UNKNOWN_SLOT'
  | 'NUMERAL'
  | 'MONEY'
  | 'NUMBER_WORD'
  | 'PROMISE'
  | 'COMPARISON'
  | 'PRODUCT_NAME'
  | 'PRODUCT_CODE'
  | 'IDENTIFIER';

export type GuardResult = { ok: true; text: string } | { ok: false; reason: GuardFailure };

const MAX_REPLY_CHARS = 1200;
const SLOT = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

// \p{Nd} is a digit in any script, so Devanagari, Tamil and the rest are all covered.
const NUMERAL = /\p{Nd}/u;
const MONEY = /₹|\brs\.?\b|\binr\b|rupee|rupay|रुपय|रुपए|रुपये|रू\.|\$|%|percent|per cent|प्रतिशत|फीसदी/iu;
// Words for amounts. Small numbers are left out, since ordinary sentences need "one" and "two".
const NUMBER_WORD =
  /\b(ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|lac|crore|sau|hazaar|hazar|pachas|sattar|assi|nabbe)\b|दस\s|बीस|तीस|चालीस|पचास|साठ|सत्तर|अस्सी|नब्बे|निन्यानवे|सौ|हज़ार|हजार|लाख|करोड़/iu;
// "feel free" is ordinary English, and has nothing to do with price.
const PROMISE = /(?<!feel )\bfree\b|\bwaive[ds]?\b|\bno charge\b|\bguarantee[ds]?\b|half off|half price|\bmuft\b|\bbilkul free\b|मुफ़्त|मुफ्त|गारंटी|\btomorrow\b|next week|\bkal tak\b|कल तक/iu;
const COMPARISON = /\bcheaper\b|\bbetter than\b|\bsasta\b|\bsaste\b|सस्ता|सस्ते|बेहतर है/iu;
const PRODUCT_CODE = /\bP\d{2}\b/;

// Fine only when the code's brief brought the subject up, as when it declines a discount.
const ONLY_IF_BRIEFED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bdiscount|\bchhoot\b|छूट/iu, 'discount'],
  [/\bno (?:one-time )?setup fee\b|\bsetup fee nahi\b|सेटअप शुल्क नहीं/iu, 'no one-time setup fee'],
];

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
  if (COMPARISON.test(own)) return { ok: false, reason: 'COMPARISON' };

  const brief = context.brief?.toLowerCase() ?? '';
  for (const [pattern, needed] of ONLY_IF_BRIEFED) {
    if (pattern.test(own) && !brief.includes(needed)) return { ok: false, reason: 'PROMISE' };
  }

  const lower = own.toLowerCase();
  if (context.catalogueNames.some((name) => lower.includes(name.toLowerCase()))) {
    return { ok: false, reason: 'PRODUCT_NAME' };
  }

  return { ok: true, text: fillSlots(text, context.values) };
}

export function fillSlots(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(SLOT, (_, key: string) => values[key] ?? '');
}
