import { textSimilarity } from './names';

export type DocumentType = 'GST_CERTIFICATE' | 'UDYAM_CERTIFICATE' | 'SIGNATORY_ID' | 'ADDRESS_PROOF';

export type GstFields = {
  gstin: string;
  legalName: string;
  tradeName: string;
  constitution: string;
  address: string;
  liabilityDate: string;
  registrationType: string;
};

export type UdyamFields = {
  udyamNumber: string;
  enterpriseName: string;
  majorActivity: string;
  city: string;
  state: string;
  registrationDate: string;
};

export type SignatoryFields = {
  name: string;
  designation: string;
  business: string;
  idNumber: string;
  validTill: string;
};

export type AddressProofFields = {
  consumerNumber: string;
  billedTo: string;
  supplyAddress: string;
  billDate: string;
};

export type ImageQuality = 'OK' | 'BLURRED';

// Variance of the Laplacian. K04's blurred certificate scores 1 and every sharp specimen scores
// 433 or more. Set well below the sharp ones, and to be recalibrated on real phone photos.
const BLUR_THRESHOLD = 100;

// Forgiving enough to read a label through OCR noise, such as "Legai narne" for "Legal name".
const LABEL_SIMILARITY = 0.6;
// Stricter for naming a document, since a false match would mislead the owner.
const SIGNATURE_SIMILARITY = 0.8;

const ADDRESS_PROOF_LABELS = ['Consumer no.', 'Billed to', 'Supply address', 'Bill date', 'Units consumed', 'Amount due'];
const SIGNATORY_LABELS = ['Name', 'Designation', 'For business', 'ID no.', 'Valid till'];

const SIGNATURES: ReadonlyArray<{ type: DocumentType; labels: readonly string[] }> = [
  { type: 'GST_CERTIFICATE', labels: ['GSTIN', 'Legal name'] },
  { type: 'UDYAM_CERTIFICATE', labels: ['Udyam reg. number', 'Enterprise name'] },
  { type: 'SIGNATORY_ID', labels: ['Designation', 'Valid till'] },
  { type: 'ADDRESS_PROOF', labels: ['Consumer no.', 'Billed to'] },
];

export function assessImageQuality(blurScore: number): ImageQuality {
  return blurScore < BLUR_THRESHOLD ? 'BLURRED' : 'OK';
}

/** Names the document in an upload slot, so the owner can be told what was found and what was expected. */
export function detectDocumentType(text: string): DocumentType | null {
  const lines = linesOf(text);
  const match = SIGNATURES.find(({ labels }) =>
    labels.every((label) => lines.some((line) => labelScore(line, label) >= SIGNATURE_SIMILARITY)),
  );
  return match?.type ?? null;
}

export function parseGstCertificate(text: string): GstFields {
  const lines = linesOf(text);
  return {
    gstin: valueAfterLabel(lines, 'GSTIN'),
    legalName: valueAfterLabel(lines, 'Legal name'),
    tradeName: valueAfterLabel(lines, 'Trade name'),
    constitution: valueAfterLabel(lines, 'Constitution'),
    // The address wraps mid-word across two labelled rows, so the parts join with no space.
    address: valueAfterLabel(lines, 'Address of principal') + valueAfterLabel(lines, 'place of business'),
    liabilityDate: valueAfterLabel(lines, 'Date of liability'),
    registrationType: valueAfterLabel(lines, 'Type of registration'),
  };
}

export function parseUdyamCertificate(text: string): UdyamFields {
  const lines = linesOf(text);
  return {
    udyamNumber: valueAfterLabel(lines, 'Udyam reg. number'),
    enterpriseName: valueAfterLabel(lines, 'Enterprise name'),
    majorActivity: valueAfterLabel(lines, 'Major activity'),
    city: valueAfterLabel(lines, 'City'),
    state: valueAfterLabel(lines, 'State'),
    registrationDate: valueAfterLabel(lines, 'Date of registration'),
  };
}

// Signatory IDs put each label on its own line, with the value on the next.
export function parseSignatoryId(text: string): SignatoryFields {
  const lines = linesOf(text);
  return {
    name: valueBelowLabel(lines, 'Name'),
    designation: valueBelowLabel(lines, 'Designation'),
    business: valueBelowLabel(lines, 'For business'),
    idNumber: valueBelowLabel(lines, 'ID no.'),
    validTill: valueBelowLabel(lines, 'Valid till'),
  };
}

export function parseAddressProof(text: string): AddressProofFields {
  const lines = linesOf(text);
  return {
    consumerNumber: valueAfterLabel(lines, 'Consumer no.'),
    billedTo: valueAfterLabel(lines, 'Billed to'),
    supplyAddress: wrappedAddress(lines, 'Supply address'),
    billDate: valueAfterLabel(lines, 'Bill date'),
  };
}

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function labelScore(line: string, label: string): number {
  const wordCount = label.split(' ').length;
  const start = line.split(/\s+/).slice(0, wordCount).join(' ');
  return textSimilarity(start.toLowerCase(), label.toLowerCase());
}

function findLabelLine(lines: readonly string[], label: string): number {
  let bestIndex = -1;
  let bestScore = LABEL_SIMILARITY;
  lines.forEach((line, index) => {
    const score = labelScore(line, label);
    if (score > bestScore || (score === bestScore && bestIndex === -1)) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function valueAfterLabel(lines: readonly string[], label: string): string {
  const line = lines[findLabelLine(lines, label)];
  if (line === undefined) return '';
  return line.split(/\s+/).slice(label.split(' ').length).join(' ');
}

function valueBelowLabel(lines: readonly string[], label: string): string {
  const index = findLabelLine(lines, label);
  if (index === -1) return '';
  const next = lines[index + 1];
  if (next === undefined || isLabel(next, SIGNATORY_LABELS)) return '';
  return next;
}

function wrappedAddress(lines: readonly string[], label: string): string {
  const index = findLabelLine(lines, label);
  if (index === -1) return '';
  const first = valueAfterLabel(lines, label);
  const next = lines[index + 1];
  return next === undefined || isLabel(next, ADDRESS_PROOF_LABELS) ? first : first + next;
}

function isLabel(line: string, labels: readonly string[]): boolean {
  return labels.some((label) => labelScore(line, label) >= SIGNATURE_SIMILARITY);
}
