import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareGstin } from '@/domain/kyc/assess-kyc';
import { parseGstCertificate, parseUdyamCertificate } from '@/domain/kyc/documents';
import { expect } from 'vitest';
import { ApiClient, grant, verifyPhone, type ApiResponse } from './api-client';
import { addGstRecord, addLead, addUdyamRecord, blurredImage, documentImage, type TestApp } from './test-app';

type Scan = { text: string; blurScore: number };
export type Applicant = {
  leadId: string;
  contactName: string;
  businessName: string;
  gstinOnFile: string;
  udyamNumberOnFile: string | null;
  documents: { gst: Scan | null; udyam: Scan | null; signatory: Scan | null; addressProof: Scan | null };
};

const specimens: { applicants: Record<string, Applicant> } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/kyc/specimens.json', import.meta.url)), 'utf8'),
);

export function applicant(key: string): Applicant {
  const found = specimens.applicants[key];
  if (!found) throw new Error(`No applicant ${key}`);
  return found;
}

export const SLOT_BY_TYPE = {
  GST_CERTIFICATE: 'gst',
  UDYAM_CERTIFICATE: 'udyam',
  SIGNATORY_ID: 'signatory',
  ADDRESS_PROOF: 'addressProof',
} as const;

export type DocumentType = keyof typeof SLOT_BY_TYPE;

/** Registry rows built from the fixture's OCR text, so these tests don't need the data pack. */
export async function seedRegistryFor(app: TestApp, key: string, gstStatus = 'Active'): Promise<void> {
  const person = applicant(key);
  const gst = person.documents.gst;
  if (gst) {
    const fields = parseGstCertificate(gst.text);
    await addGstRecord(app, {
      gstin: person.gstinOnFile,
      legalName: fields.legalName,
      tradeName: fields.tradeName,
      address: fields.address,
      status: gstStatus,
    });
  }
  const udyam = person.documents.udyam;
  if (udyam && person.udyamNumberOnFile) {
    const fields = parseUdyamCertificate(udyam.text);
    if (fields.udyamNumber) {
      await addUdyamRecord(app, {
        udyamNumber: fields.udyamNumber,
        enterpriseName: fields.enterpriseName,
        majorActivity: fields.majorActivity,
      });
    }
  } else if (person.udyamNumberOnFile) {
    await addUdyamRecord(app, { udyamNumber: person.udyamNumberOnFile, enterpriseName: person.businessName });
  }
  await addLead(app, {
    id: person.leadId,
    gstin: person.gstinOnFile,
    contactName: person.contactName,
    businessName: person.businessName,
    udyamNumber: person.udyamNumberOnFile,
  });
}

let uploadCounter = 0;

export async function postDocument(
  client: ApiClient,
  applicationId: string,
  documentType: string,
  image: Buffer,
  key = `key-${(uploadCounter += 1)}-${Date.now()}`,
): Promise<ApiResponse> {
  const form = new FormData();
  form.set('documentType', documentType);
  form.set('file', new File([new Uint8Array(image)], 'upload.bin'));
  return client.request('POST', `/api/v1/kyc-applications/${applicationId}/documents`, {
    form,
    headers: { 'idempotency-key': key },
  });
}

/** Uploads an image while the stub OCR reads this specimen's real captured text. */
export async function uploadSpecimen(
  app: TestApp,
  client: ApiClient,
  applicationId: string,
  key: string,
  documentType: DocumentType,
): Promise<ApiResponse> {
  const scan = applicant(key).documents[SLOT_BY_TYPE[documentType]];
  if (!scan) throw new Error(`${key} has no ${documentType}`);
  const blurred = scan.blurScore < 100;
  if (!blurred) app.stubOcr.willRead(scan.text);
  return postDocument(client, applicationId, documentType, blurred ? await blurredImage() : await documentImage());
}

export const needsGstinLines = [
  { productId: 'P01', quantity: 1 },
  { productId: 'P15', quantity: 1 },
];
export const noGstinLines = [{ productId: 'P01', quantity: 1 }];

export const ACTIVE_PROFILE = { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true };

/** Everything before KYC: consent, quote, verified phone, acceptance, KYC consent. */
export async function acceptedQuote(
  client: ApiClient,
  lines: ReadonlyArray<{ productId: string; quantity: number }> = needsGstinLines,
  profile: object = ACTIVE_PROFILE,
  phone = '9876541234',
): Promise<string> {
  await grant(client, 'advisor_profile');
  const quote = await client.post('/api/v1/quotes', { profile, lines });
  expect(quote.status).toBe(201);
  await verifyPhone(client, phone);
  const accepted = await client.post(`/api/v1/quotes/${quote.body.id}/acceptance`);
  expect(accepted.status).toBe(200);
  await grant(client, 'kyc_verification');
  return quote.body.id;
}

/** Runs every document this applicant has through upload, returning the last response. */
export async function uploadAll(app: TestApp, client: ApiClient, applicationId: string, key: string): Promise<ApiResponse> {
  const person = applicant(key);
  let last: ApiResponse | null = null;
  for (const type of Object.keys(SLOT_BY_TYPE) as DocumentType[]) {
    if (person.documents[SLOT_BY_TYPE[type]]) {
      last = await uploadSpecimen(app, client, applicationId, key, type);
      expect(last.status, JSON.stringify(last.body)).toBeLessThan(300);
    }
  }
  if (!last) throw new Error(`${key} has no documents`);
  return last;
}

/** A value that passes the checksum, for the GSTIN of this specimen as OCR read it. */
export function ocrGstin(key: string): string {
  const gst = applicant(key).documents.gst;
  return prepareGstin(parseGstCertificate(gst?.text ?? '').gstin).value;
}
