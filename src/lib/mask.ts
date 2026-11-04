const DOT = '•';
const FALLBACK_MASK = DOT.repeat(5);

const GSTIN_LENGTH = 15;
const UDYAM_SHAPE = /^(UDYAM-[A-Z]{2}-\d{2}-)(\d{7})$/;

// Deliberately looser than a valid GSTIN, because OCR values that fail the checksum still identify someone.
const GSTIN_LIKE = /\b\d{2}[A-Z0-9]{13}\b/g;
const UDYAM_LIKE = /\bUDYAM-[A-Z]{2}-\d{2}-\d{4,}\b/g;
const PHONE_LIKE = /(?<![\d-])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

export function maskGstin(value: string): string {
  if (value.length !== GSTIN_LENGTH) return FALLBACK_MASK;
  return `${value.slice(0, 5)}${DOT.repeat(7)}${value.slice(-3)}`;
}

export function maskUdyam(value: string): string {
  const match = UDYAM_SHAPE.exec(value);
  if (!match) return FALLBACK_MASK;
  return `${match[1]}${DOT.repeat(3)}${value.slice(-4)}`;
}

export function maskSignatoryId(value: string): string {
  if (value.length <= 4) return FALLBACK_MASK;
  return `${DOT.repeat(4)}${value.slice(-4)}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return FALLBACK_MASK;
  return `${DOT.repeat(6)}${digits.slice(-4)}`;
}

/** Masks any identifier found in text. The logger uses it as a last line of defence. */
export function scrubIdentifiers(text: string): string {
  return text
    .replace(UDYAM_LIKE, (value) => maskUdyam(value))
    .replace(GSTIN_LIKE, (value) => maskGstin(value))
    .replace(PHONE_LIKE, (value) => maskPhone(value));
}
