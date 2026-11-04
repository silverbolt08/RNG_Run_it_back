import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assessKyc,
  prepareGstin,
  type DocumentSlot,
  type GstFields,
  type GstRecord,
  type KycInput,
  type RegistryLookup,
  type UdyamFields,
  type UdyamRecord,
} from '@/domain/kyc/assess-kyc';
import {
  assessImageQuality,
  parseAddressProof,
  parseGstCertificate,
  parseSignatoryId,
  parseUdyamCertificate,
} from '@/domain/kyc/documents';
import { readPackCsv } from '../helpers/data-pack';

type Scan = { text: string; confidence: number; blurScore: number; rotationDegrees: number };
type Applicant = {
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

const gstRegistry = new Map(readPackCsv('mock_gstin_registry.csv').map((row) => [row.gstin ?? '', row]));
const udyamRegistry = new Map(readPackCsv('mock_udyam_registry.csv').map((row) => [row.udyam_number ?? '', row]));

function lookupGst(gstin: string): RegistryLookup<GstRecord> {
  const row = gstRegistry.get(gstin);
  if (!row) return { status: 'NOT_FOUND' };
  return {
    status: 'FOUND',
    record: {
      gstin,
      legalName: row.legal_name ?? '',
      tradeName: row.trade_name ?? '',
      address: row.principal_place_of_business ?? '',
      status: row.status as GstRecord['status'],
    },
  };
}

function lookupUdyam(number: string | null): RegistryLookup<UdyamRecord> {
  if (!number) return { status: 'NOT_RUN' };
  const row = udyamRegistry.get(number);
  if (!row) return { status: 'NOT_FOUND' };
  return {
    status: 'FOUND',
    record: {
      udyamNumber: number,
      enterpriseName: row.enterprise_name ?? '',
      majorActivity: row.major_activity ?? '',
      city: row.city ?? '',
      state: row.state ?? '',
      dateOfRegistration: row.date_of_registration ?? '',
    },
  };
}

function slot<T>(scan: Scan | null, parse: (text: string) => T): DocumentSlot<T> {
  if (!scan) return { quality: 'MISSING' };
  const quality = assessImageQuality(scan.blurScore);
  return quality === 'OK' ? { quality: 'OK', fields: parse(scan.text) } : { quality };
}

/** Runs one applicant the way the pipeline will: read, prepare the GSTIN, look up, assess. */
function runApplicant(key: string, ownerConfirmsGstin?: string, bundleNeedsGstin = true) {
  const applicant = specimens.applicants[key];
  if (!applicant) throw new Error(`No applicant ${key}`);

  const gst = slot<GstFields>(applicant.documents.gst, parseGstCertificate);
  const udyam = slot<UdyamFields>(applicant.documents.udyam, parseUdyamCertificate);

  if (gst.quality === 'OK' && ownerConfirmsGstin) gst.fields.gstin = ownerConfirmsGstin;
  const prepared = gst.quality === 'OK' ? prepareGstin(gst.fields.gstin) : null;
  const canLook = prepared?.readyForLookup ?? false;

  const udyamNumber = udyam.quality === 'OK' ? udyam.fields.udyamNumber || null : applicant.udyamNumberOnFile;

  const input: KycInput = {
    today: '2026-07-15',
    contactName: applicant.contactName,
    businessName: applicant.businessName,
    bundleNeedsGstin,
    gstinConfirmedByOwner: Boolean(ownerConfirmsGstin),
    gst,
    udyam,
    signatory: slot(applicant.documents.signatory, parseSignatoryId),
    addressProof: slot(applicant.documents.addressProof, parseAddressProof),
    gstLookup: canLook && prepared ? lookupGst(prepared.value) : { status: 'NOT_RUN' },
    udyamLookup: lookupUdyam(udyamNumber),
  };
  return assessKyc(input);
}

const blocking = (result: ReturnType<typeof assessKyc>) =>
  result.checks.filter((check) => check.outcome === 'FAIL' && check.severity !== 'ADVISORY').map((check) => check.id);

/**
 * These run on real OCR output. The expected results are our own reading of the specimens,
 * not the judges' answer key. Clean applicants passing matters as much as faults being caught.
 */
describe('K01 to K12 through the whole pipeline', () => {
  it('K01 is rejected for a bundle that needs a GSTIN, because it is Cancelled', () => {
    const result = runApplicant('K01');
    expect(result.verdict).toBe('REJECTED');
    expect(blocking(result)).toEqual(['GST_STATUS', 'UDYAM_PRESENT']);
  });

  it('K01 can still continue on a bundle that needs no GSTIN, with its Udyam certificate reviewed', () => {
    const result = runApplicant('K01', undefined, false);
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(blocking(result)).toEqual(['UDYAM_PRESENT']);
  });

  it('K02 is verified, despite the skewed scan and the O/0 confusion', () => {
    const result = runApplicant('K02');
    expect(result.verdict).toBe('VERIFIED');
    expect(result.checks.find((c) => c.id === 'GST_FORMAT')?.evidence).toMatchObject({ repaired: 'true' });
  });

  it.each(['K03', 'K08', 'K09', 'K12'])('%s has no problem and is verified', (key) => {
    const result = runApplicant(key);
    expect(result.verdict).toBe('VERIFIED');
    expect(blocking(result)).toEqual([]);
  });

  it('K04 is asked to retake its blurred GST certificate', () => {
    const result = runApplicant('K04');
    expect(result.verdict).toBe('RETAKE');
    expect(blocking(result)).toEqual(['GST_DOCUMENT']);
  });

  it('K05 is verified, with the registry filling in for its missing Udyam certificate', () => {
    const result = runApplicant('K05');
    expect(result.verdict).toBe('VERIFIED');
    expect(result.checks.find((c) => c.id === 'UDYAM_PRESENT')).toMatchObject({
      outcome: 'PASS',
      evidence: { source: 'REGISTRY' },
    });
  });

  it('K06 first asks the owner to check the number', () => {
    const result = runApplicant('K06');
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
    expect(blocking(result)).toEqual(['GST_FORMAT']);
  });

  it('K06 is rejected once the owner confirms what is printed', () => {
    const result = runApplicant('K06', '08YKZXS8189L1ZO');
    expect(result.verdict).toBe('REJECTED');
    expect(blocking(result)).toEqual(['GST_FORMAT']);
  });

  it('K06 is still rejected if the owner accepts the look-alike suggestion, by the registry', () => {
    const suggested = prepareGstin('08YKZXS8189L1ZO').suggestion;
    expect(suggested).not.toBeNull();
    const result = runApplicant('K06', suggested ?? '');
    expect(result.verdict).toBe('REJECTED');
    expect(blocking(result)).toEqual(['GST_FOUND']);
  });

  it('K07 goes to manual review, because the certificate names a different business', () => {
    const result = runApplicant('K07');
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(blocking(result)).toEqual(['GST_NAME']);
  });

  it('K10 first asks the owner to check the number OCR misread', () => {
    const result = runApplicant('K10');
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
    expect(blocking(result)).toContain('GST_FORMAT');
  });

  it('K10 goes to manual review for its signatory once the number is corrected', () => {
    const result = runApplicant('K10', prepareGstin('27QHIXK0658U1ZL').suggestion ?? '');
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(blocking(result)).toEqual(['SIGNATORY_NAME']);
  });

  it('K11 is asked for a newer bill', () => {
    const result = runApplicant('K11');
    expect(result.verdict).toBe('RETAKE');
    expect(blocking(result)).toEqual(['ADDRESS_AGE']);
    expect(result.checks.find((c) => c.id === 'ADDRESS_AGE')?.evidence).toMatchObject({ ageDays: '257' });
  });

  it('records the Udyam date differences as advisory on the four clean applicants', () => {
    for (const key of ['K03', 'K08', 'K09', 'K12']) {
      const date = runApplicant(key).checks.find((c) => c.id === 'UDYAM_DATE');
      expect(date).toMatchObject({ outcome: 'FAIL', severity: 'ADVISORY' });
    }
  });
});
