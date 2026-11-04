// Identifiers are taken out of chat before it is stored or sent to the LLM. Each pattern is checked
// against the owner's text in order, with the most specific first, so a GSTIN isn't half-read as a PAN.
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi, '[GSTIN removed]'],
  // A looser net for a mistyped GSTIN: 15 characters of letters and digits with both in them.
  [/\b(?=[0-9A-Z]*\d)(?=[0-9A-Z]*[A-Z])[0-9A-Z]{15}\b/gi, '[GSTIN removed]'],
  [/\bUDYAM[-\s]?[A-Z]{2}[-\s]?\d{2}[-\s]?\d{7}\b/gi, '[Udyam number removed]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[PAN removed]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]'],
  // Aadhaar: 12 digits, however they are spaced.
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[ID number removed]'],
  // An Indian mobile number, with or without a country code.
  [/(?:\+?91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone removed]'],
];

export function redactIdentifiers(text: string): string {
  return PATTERNS.reduce((result, [pattern, label]) => result.replace(pattern, label), text);
}

/** True if text still looks like it holds an identifier, for checking what the LLM wrote. */
export function containsIdentifier(text: string): boolean {
  return redactIdentifiers(text) !== text;
}
