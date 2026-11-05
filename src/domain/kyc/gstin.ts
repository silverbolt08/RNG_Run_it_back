// The 4th PAN character (position 6) is always X in the data pack, which a real validator
// would reject. This pattern accepts it because position 6 only has to be a letter.
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_LENGTH = 15;
const CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const STATE_BY_CODE: Readonly<Record<string, string>> = {
  '03': 'Punjab',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '19': 'West Bengal',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

// Zero-based positions with a fixed character class in a GSTIN.
const DIGIT_POSITIONS: ReadonlySet<number> = new Set([0, 1, 7, 8, 9, 10]);
const LETTER_POSITIONS: ReadonlySet<number> = new Set([2, 3, 4, 5, 6, 11]);
const FIXED_Z_POSITION = 13;
const CHECK_POSITION = 14;

const LETTER_FOR_DIGIT: Readonly<Record<string, string>> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' };
const DIGIT_FOR_LETTER: Readonly<Record<string, string>> = { O: '0', I: '1', S: '5', B: '8' };
// OCR read this position's fixed Z as 7 on four of the twelve specimens.
const MISREADS_OF_Z: ReadonlySet<string> = new Set(['7', '2']);

// Letters only. Altered digits are the fault KYC must catch, so a digit is never suggested.
const LOOKALIKE_LETTERS: Readonly<Record<string, string>> = {
  I: 'JL',
  J: 'I',
  L: 'I',
  O: 'QD',
  Q: 'O',
  D: 'O',
  U: 'V',
  V: 'U',
};

export type GstinChange = { position: number; from: string; to: string };

export type GstinRepair = {
  value: string;
  changes: GstinChange[];
  checksumOk: boolean;
};

export function isValidGstinFormat(value: string): boolean {
  return GSTIN_PATTERN.test(value);
}

export function isValidGstinChecksum(value: string): boolean {
  if (!isValidGstinFormat(value)) return false;
  return value.charAt(CHECK_POSITION) === expectedCheckCharacter(value);
}

export function gstinStateName(value: string): string | null {
  return STATE_BY_CODE[value.slice(0, 2)] ?? null;
}

/**
 * Repairs a character only where its position forbids what OCR read, so a real fault in an
 * allowed character survives. It never looks at a registry. The result still has to be
 * shown to the owner to confirm.
 */
export function repairGstinByPosition(raw: string): GstinRepair {
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (cleaned.length !== GSTIN_LENGTH) {
    return { value: cleaned, changes: [], checksumOk: false };
  }

  const changes: GstinChange[] = [];
  const repaired = [...cleaned].map((from, index) => {
    const to = repairedCharacter(from, index);
    if (to !== from) changes.push({ position: index + 1, from, to });
    return to;
  });
  const value = repaired.join('');
  if (isValidGstinChecksum(value)) return { value, changes, checksumOk: true };

  // The check character may be a letter or a digit, so only the checksum can settle O or 0.
  const checkCharacter = value.charAt(CHECK_POSITION);
  if (checkCharacter === 'O' || checkCharacter === '0') {
    const to = checkCharacter === 'O' ? '0' : 'O';
    const swapped = value.slice(0, CHECK_POSITION) + to;
    if (isValidGstinChecksum(swapped)) {
      return {
        value: swapped,
        changes: [...changes, { position: CHECK_POSITION + 1, from: checkCharacter, to }],
        checksumOk: true,
      };
    }
  }
  return { value, changes, checksumOk: false };
}

/**
 * Offers one look-alike letter swap that passes the checksum, for the owner to confirm. With
 * no candidate, or more than one, it offers nothing and the owner reads the number themselves.
 */
export function suggestGstinLookalike(value: string): string | null {
  if (!isValidGstinFormat(value) || isValidGstinChecksum(value)) return null;

  const candidates: string[] = [];
  for (let index = 0; index < CHECK_POSITION; index++) {
    const lookalikes = LOOKALIKE_LETTERS[value.charAt(index)] ?? '';
    for (const letter of lookalikes) {
      const candidate = value.slice(0, index) + letter + value.slice(index + 1);
      if (isValidGstinChecksum(candidate)) candidates.push(candidate);
    }
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function repairedCharacter(character: string, index: number): string {
  if (DIGIT_POSITIONS.has(index)) return DIGIT_FOR_LETTER[character] ?? character;
  if (LETTER_POSITIONS.has(index)) return LETTER_FOR_DIGIT[character] ?? character;
  if (index === FIXED_Z_POSITION && MISREADS_OF_Z.has(character)) return 'Z';
  return character;
}

function expectedCheckCharacter(value: string): string {
  const base = CHECKSUM_ALPHABET.length;
  let total = 0;
  for (let index = 0; index < CHECK_POSITION; index++) {
    const product = CHECKSUM_ALPHABET.indexOf(value.charAt(index)) * (index % 2 === 0 ? 1 : 2);
    total += Math.floor(product / base) + (product % base);
  }
  return CHECKSUM_ALPHABET.charAt((base - (total % base)) % base);
}

// OCR mistakes a character or two. Far more than this is a different number, not a correction.
const MAX_CORRECTION_EDITS = 4;

/** Whether a number the owner typed could be what OCR misread, rather than some other business's. */
export function isPlausibleCorrection(read: string, typed: string): boolean {
  if (read === '') return false;
  return editDistance(read.toUpperCase(), typed.toUpperCase()) <= MAX_CORRECTION_EDITS;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
