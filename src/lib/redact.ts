// Identifiers are taken out of chat before it is stored or sent to the LLM. Patterns run in order,
// most specific first, so a GSTIN isn't half-read as a PAN. Separators are allowed inside them,
// because owners type "98765 41234" or "27 AAAAA 0000 A 1Z5" as often as the tidy form.
const GAP = '[\\s.-]?';
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`\\b\\d{2}${GAP}[A-Z]{5}${GAP}\\d{4}${GAP}[A-Z]${GAP}[0-9A-Z]${GAP}Z${GAP}[0-9A-Z]\\b`, 'gi'), '[GSTIN removed]'],
  // A looser net for a mistyped GSTIN: 15 characters of letters and digits with both in them.
  [/\b(?=[0-9A-Z]*\d)(?=[0-9A-Z]*[A-Z])[0-9A-Z]{15}\b/gi, '[GSTIN removed]'],
  [new RegExp(`\\b(?:UDYAM${GAP})?[A-Z]{2}${GAP}\\d{2}${GAP}\\d{6,7}\\b`, 'gi'), '[Udyam number removed]'],
  [new RegExp(`\\b[A-Z]{5}${GAP}\\d{4}${GAP}[A-Z]\\b`, 'gi'), '[PAN removed]'],
  // Voter ID: three letters then seven digits.
  [/\b[A-Z]{3}\d{7}\b/gi, '[ID number removed]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]'],
  // A UPI handle, which is an email without the dot.
  [/\b[\w.-]+@[a-z][a-z0-9]{1,15}\b/gi, '[UPI ID removed]'],
  // Any long run of digits, however spaced, is a phone, Aadhaar, account or similar number.
  [/(?:\+\s?)?\d(?:[\s.,()-]{0,2}\d){7,}/g, '[number removed]'],
  // A name given outright. Names in general can't be spotted, and the notice asks owners not to type them.
  [/\b(my name is|name is|mera naam)\s+[\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+){0,2}/giu, '[name removed]'],
  [/मेरा नाम\s+[\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+){0,2}/gu, '[name removed]'],
];

// Each Indic block's digits run in order from a zero ending in 6, as in Devanagari's U+0966.
const INDIC_DIGIT = /[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g;

/** Written in Latin digits from here on, so one set of patterns covers every script. */
function toLatinDigits(text: string): string {
  return text.replace(INDIC_DIGIT, (digit) => String((digit.charCodeAt(0) & 0xf) - 6));
}

export function redactIdentifiers(text: string): string {
  return PATTERNS.reduce((result, [pattern, label]) => result.replace(pattern, label), toLatinDigits(text));
}

/** True if text still looks like it holds an identifier, for checking what the LLM wrote. */
export function containsIdentifier(text: string): boolean {
  return redactIdentifiers(text) !== toLatinDigits(text);
}
