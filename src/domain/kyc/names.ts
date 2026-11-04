// Legal suffixes that a certificate and a bill may or may not print for the same business.
const IGNORED_WORDS: ReadonlySet<string> = new Set(['pvt', 'private', 'ltd', 'limited', 'llp']);

// High enough to allow one OCR slip in a typical name, but not a different person or business.
const NAME_SIMILARITY = 0.9;
const ADDRESS_LETTER_SIMILARITY = 0.92;

const PROPRIETOR_PATTERN = /^(.+?)\s*\(\s*Prop\.?\s*(.+?)\s*\)\s*$/i;

export type ProprietorName = { person: string; business: string };

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^0-9a-z]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '' && !IGNORED_WORDS.has(word))
    .join(' ');
}

export function isSameName(a: string, b: string): boolean {
  const first = normaliseName(a);
  const second = normaliseName(b);
  if (first === '' || second === '') return false;
  return first === second || textSimilarity(first, second) >= NAME_SIMILARITY;
}

/**
 * Digits must match exactly, because "Unit 71" and "Unit 17" are nearly identical as text but
 * are different places. Letters are compared loosely, because OCR loses spaces at wrapped rows.
 */
export function isSameAddress(a: string, b: string): boolean {
  const lettersA = a.toLowerCase().replace(/[^a-z]/g, '');
  const lettersB = b.toLowerCase().replace(/[^a-z]/g, '');
  if (lettersA === '' || lettersB === '') return false;
  if (a.replace(/\D/g, '') !== b.replace(/\D/g, '')) return false;
  return textSimilarity(lettersA, lettersB) >= ADDRESS_LETTER_SIMILARITY;
}

/** Reads "Neha Kaur (Prop. Vindhya Tours & Travels)" into the person and the business. */
export function parseProprietorName(legalName: string): ProprietorName | null {
  const match = PROPRIETOR_PATTERN.exec(legalName.trim());
  if (!match?.[1] || !match[2]) return null;
  return { person: match[1], business: match[2] };
}

/** Compares a proprietor's person and business separately, so a short change can't hide in a long name. */
export function isSameLegalName(a: string, b: string): boolean {
  const first = parseProprietorName(a);
  const second = parseProprietorName(b);
  if (first && second) {
    return isSameName(first.person, second.person) && isSameName(first.business, second.business);
  }
  return isSameName(a, b);
}

/** How alike two strings are, from 0 to 1. Two empty strings score 0, so blanks never match. */
export function textSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
