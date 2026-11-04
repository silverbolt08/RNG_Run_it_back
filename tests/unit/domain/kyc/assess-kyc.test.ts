import { describe, expect, it } from 'vitest';
import {
  assessKyc,
  prepareGstin,
  requiredDocuments,
  type GstRecord,
  type KycCheckId,
  type KycInput,
  type UdyamRecord,
} from '@/domain/kyc/assess-kyc';

const TODAY = '2026-07-15';
const GSTIN = '27XUIXG0767D1ZP';
const UDYAM = 'UDYAM-MH-00-9516696';
const ADDRESS = 'Shop/Unit 80, Civil Lines, Nagpur, Maharashtra - 411231';

const GST_RECORD: GstRecord = {
  gstin: GSTIN,
  legalName: 'Joseph Singh (Prop. Ganesh Woodcraft)',
  tradeName: 'Ganesh Woodcraft',
  address: ADDRESS,
  status: 'Active',
};

const UDYAM_RECORD: UdyamRecord = {
  udyamNumber: UDYAM,
  enterpriseName: 'Ganesh Woodcraft',
  majorActivity: 'Manufacturing',
  city: 'Nagpur',
  state: 'Maharashtra',
  dateOfRegistration: '2024-11-21',
};

function cleanInput(): KycInput {
  return {
    today: TODAY,
    contactName: 'Joseph Singh',
    businessName: 'Ganesh Woodcraft',
    bundleNeedsGstin: true,
    gstinConfirmedByOwner: false,
    gst: {
      quality: 'OK',
      fields: {
        gstin: GSTIN,
        legalName: GST_RECORD.legalName,
        tradeName: GST_RECORD.tradeName,
        constitution: 'Proprietorship',
        address: ADDRESS,
        liabilityDate: '2020-02-10',
        registrationType: 'Regular',
      },
    },
    udyam: {
      quality: 'OK',
      fields: {
        udyamNumber: UDYAM,
        enterpriseName: 'Ganesh Woodcraft',
        majorActivity: 'Manufacturing',
        city: 'Nagpur',
        state: 'Maharashtra',
        registrationDate: '2024-11-21',
      },
    },
    signatory: {
      quality: 'OK',
      fields: {
        name: 'Joseph Singh',
        designation: 'Owner',
        business: 'Ganesh Woodcraft',
        idNumber: 'SYN-ID-447889',
        validTill: '2028-07-04',
      },
    },
    addressProof: {
      quality: 'OK',
      fields: {
        consumerNumber: '3438517928',
        billedTo: 'Ganesh Woodcraft',
        supplyAddress: ADDRESS,
        billDate: '2026-05-30',
      },
    },
    gstLookup: { status: 'FOUND', record: GST_RECORD },
    udyamLookup: { status: 'FOUND', record: UDYAM_RECORD },
  };
}

type Change = (input: KycInput) => void;

function assessWith(change: Change) {
  const input = cleanInput();
  change(input);
  return assessKyc(input);
}

const failedIds = (result: ReturnType<typeof assessKyc>): KycCheckId[] =>
  result.checks.filter((check) => check.outcome === 'FAIL').map((check) => check.id);

const checkOf = (result: ReturnType<typeof assessKyc>, id: KycCheckId) => {
  const check = result.checks.find((item) => item.id === id);
  if (!check) throw new Error(`No check ${id}`);
  return check;
};

describe('a clean applicant', () => {
  it('is verified with nothing failing', () => {
    const result = assessKyc(cleanInput());
    expect(result.verdict).toBe('VERIFIED');
    expect(failedIds(result)).toEqual([]);
  });
});

describe('GST_FORMAT', () => {
  it('asks the owner to confirm a GSTIN that fails the checksum, rather than rejecting', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.gstin = '27QHIXK0658U1ZL';
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
    expect(checkOf(result, 'GST_FORMAT')).toMatchObject({ outcome: 'FAIL', onFail: 'NEEDS_CONFIRMATION' });
  });

  it('offers the look-alike suggestion when there is one', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.gstin = '27QHIXK0658U1ZL';
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(checkOf(result, 'GST_FORMAT').evidence).toMatchObject({ suggestion: '27QHJXK0658U1ZL' });
  });

  it('rejects once the owner confirms a value that still fails', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.gstin = '08YKZXS8189L1ZO';
      input.gstinConfirmedByOwner = true;
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('REJECTED');
    expect(checkOf(result, 'GST_FORMAT')).toMatchObject({ outcome: 'FAIL', onFail: 'REJECTED' });
  });

  it('passes a GSTIN that position repair fixes, and records that it was repaired', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.gstin = '27XUIXGO767D1ZP';
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'GST_FORMAT').evidence).toMatchObject({ repaired: 'true' });
  });
});

describe('GST_FOUND', () => {
  it('asks for confirmation when a valid-looking GSTIN is not in the registry', () => {
    const result = assessWith((input) => {
      input.gstLookup = { status: 'NOT_FOUND' };
    });
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
  });

  it('rejects once the owner confirms it', () => {
    const result = assessWith((input) => {
      input.gstLookup = { status: 'NOT_FOUND' };
      input.gstinConfirmedByOwner = true;
    });
    expect(result.verdict).toBe('REJECTED');
    expect(failedIds(result)).toContain('GST_FOUND');
  });
});

describe('GST_STATUS', () => {
  it.each(['Cancelled', 'Suspended'] as const)('rejects %s when the bundle needs a GSTIN', (status) => {
    const result = assessWith((input) => {
      input.gstLookup = { status: 'FOUND', record: { ...GST_RECORD, status } };
    });
    expect(result.verdict).toBe('REJECTED');
    expect(checkOf(result, 'GST_STATUS').evidence).toMatchObject({ status });
  });

  it.each(['Cancelled', 'Suspended'] as const)('does not stop a bundle that needs no GSTIN (%s)', (status) => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      input.gstLookup = { status: 'FOUND', record: { ...GST_RECORD, status } };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'GST_STATUS')).toMatchObject({ outcome: 'FAIL', severity: 'ADVISORY' });
  });
});

describe('GST_NAME', () => {
  it('sends a certificate name that differs from the registry to manual review', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.legalName = 'Joseph Singh (Prop. Shri Woodworks)';
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['GST_NAME']);
  });

  it('does not reveal the name the registry holds', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.legalName = 'Joseph Singh (Prop. Shri Woodworks)';
    });
    expect(JSON.stringify(result)).not.toContain('Prop. Ganesh');
  });
});

describe('GST_ADDRESS and GST_STATE', () => {
  it('sends a certificate address that differs from the registry to manual review', () => {
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.address = 'Shop/Unit 81, Civil Lines, Nagpur, Maharashtra - 411231';
      if (input.addressProof.quality === 'OK') {
        input.addressProof.fields.supplyAddress = 'Shop/Unit 81, Civil Lines, Nagpur, Maharashtra - 411231';
      }
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['GST_ADDRESS']);
  });

  it('flags a GSTIN state code that does not match the address', () => {
    const elsewhere = 'Shop/Unit 80, Civil Lines, Jaipur, Rajasthan - 411231';
    const result = assessWith((input) => {
      if (input.gst.quality === 'OK') input.gst.fields.address = elsewhere;
      if (input.addressProof.quality === 'OK') input.addressProof.fields.supplyAddress = elsewhere;
      input.gstLookup = { status: 'FOUND', record: { ...GST_RECORD, address: elsewhere } };
    });
    expect(failedIds(result)).toEqual(['GST_STATE']);
    expect(result.verdict).toBe('MANUAL_REVIEW');
  });
});

describe('Udyam checks', () => {
  it('passes when the certificate is missing but the number on file is in the registry', () => {
    const result = assessWith((input) => {
      input.udyam = { quality: 'MISSING' };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'UDYAM_PRESENT')).toMatchObject({ outcome: 'PASS', evidence: { source: 'REGISTRY' } });
  });

  it('never blocks a sale on a missing Udyam alone', () => {
    const result = assessWith((input) => {
      input.udyam = { quality: 'MISSING' };
      input.udyamLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'UDYAM_PRESENT').outcome).toBe('SKIPPED');
  });

  // K01: a certificate with no number on it deserves a second look.
  it('sends a certificate with no number to manual review', () => {
    const result = assessWith((input) => {
      if (input.udyam.quality === 'OK') input.udyam.fields.udyamNumber = '';
      input.udyamLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['UDYAM_PRESENT']);
    expect(checkOf(result, 'UDYAM_PRESENT').evidence).toEqual({ problem: 'NO_NUMBER' });
  });

  it('sends a number not in the registry to manual review', () => {
    const result = assessWith((input) => {
      input.udyamLookup = { status: 'NOT_FOUND' };
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['UDYAM_PRESENT']);
  });

  it('flags a different enterprise name softly', () => {
    const result = assessWith((input) => {
      if (input.udyam.quality === 'OK') input.udyam.fields.enterpriseName = 'Other Works';
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['UDYAM_NAME']);
  });

  // Every numbered specimen differs from the registry on date, so a hard or soft fail would stop everyone.
  it('records a date or activity difference without changing the verdict', () => {
    const result = assessWith((input) => {
      if (input.udyam.quality === 'OK') {
        input.udyam.fields.registrationDate = '2020-01-01';
        input.udyam.fields.majorActivity = 'Trading';
      }
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(failedIds(result)).toEqual(['UDYAM_DATE', 'UDYAM_ACTIVITY']);
    expect(checkOf(result, 'UDYAM_DATE').severity).toBe('ADVISORY');
    expect(checkOf(result, 'UDYAM_ACTIVITY').severity).toBe('ADVISORY');
  });
});

describe('address proof checks', () => {
  const billDated = (billDate: string) =>
    assessWith((input) => {
      if (input.addressProof.quality === 'OK') input.addressProof.fields.billDate = billDate;
    });

  it('passes a bill exactly 90 days old', () => {
    expect(billDated('2026-04-16').verdict).toBe('VERIFIED');
  });

  it('passes a bill dated today', () => {
    expect(billDated(TODAY).verdict).toBe('VERIFIED');
  });

  it('asks for a newer bill at 91 days', () => {
    const result = billDated('2026-04-15');
    expect(result.verdict).toBe('RETAKE');
    expect(failedIds(result)).toEqual(['ADDRESS_AGE']);
  });

  // K11's bill.
  it('asks for a newer bill at 257 days and reports the age', () => {
    const result = billDated('2025-10-31');
    expect(result.verdict).toBe('RETAKE');
    expect(checkOf(result, 'ADDRESS_AGE').evidence).toMatchObject({ ageDays: '257' });
  });

  it('does not accept a bill dated in the future', () => {
    expect(failedIds(billDated('2026-07-16'))).toEqual(['ADDRESS_AGE']);
  });

  it('asks the owner to confirm a date it can not read', () => {
    const result = billDated('2O26-05-3O');
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
  });

  it('asks for the right bill when its address differs from the GST address', () => {
    const result = assessWith((input) => {
      if (input.addressProof.quality === 'OK') input.addressProof.fields.supplyAddress = 'Somewhere Else 12, Pune';
    });
    expect(result.verdict).toBe('RETAKE');
    expect(failedIds(result)).toEqual(['ADDRESS_MATCH']);
  });

  it('sends a bill in another name to manual review, since a landlord bill is common', () => {
    const result = assessWith((input) => {
      if (input.addressProof.quality === 'OK') input.addressProof.fields.billedTo = 'Ramesh Landlord';
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['BILL_NAME']);
  });
});

describe('signatory checks', () => {
  // K10.
  it('sends an ID that differs from the application contact to manual review', () => {
    const result = assessWith((input) => {
      input.contactName = 'Fatima Menon';
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['SIGNATORY_NAME']);
  });

  it('checks a proprietor against the person on the GST certificate too', () => {
    const result = assessWith((input) => {
      input.contactName = 'Pooja Rao';
      if (input.signatory.quality === 'OK') input.signatory.fields.name = 'Pooja Rao';
    });
    expect(failedIds(result)).toEqual(['SIGNATORY_NAME']);
  });

  it('still checks the proprietor when no contact name was given', () => {
    const result = assessWith((input) => {
      input.contactName = null;
      if (input.signatory.quality === 'OK') input.signatory.fields.name = 'Pooja Rao';
    });
    expect(failedIds(result)).toEqual(['SIGNATORY_NAME']);
  });

  const validTill = (date: string) =>
    assessWith((input) => {
      if (input.signatory.quality === 'OK') input.signatory.fields.validTill = date;
    });

  it('passes an ID valid after today', () => {
    expect(validTill('2026-07-16').verdict).toBe('VERIFIED');
  });

  it('asks for a current ID when it ends today', () => {
    const result = validTill(TODAY);
    expect(result.verdict).toBe('RETAKE');
    expect(failedIds(result)).toEqual(['SIGNATORY_VALID']);
  });

  it('asks for a current ID when it has expired', () => {
    expect(validTill('2020-01-01').verdict).toBe('RETAKE');
  });

  it('sends an ID for another business to manual review', () => {
    const result = assessWith((input) => {
      if (input.signatory.quality === 'OK') input.signatory.fields.business = 'Other Traders';
    });
    expect(result.verdict).toBe('MANUAL_REVIEW');
    expect(failedIds(result)).toEqual(['SIGNATORY_BUSINESS']);
  });

  it('asks the owner to confirm a name OCR could not read', () => {
    const result = assessWith((input) => {
      if (input.signatory.quality === 'OK') input.signatory.fields.name = '';
    });
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
  });
});

describe('unreadable or missing documents', () => {
  // K04.
  it('asks for a retake of a blurred GST certificate, and keeps the other results', () => {
    const result = assessWith((input) => {
      input.gst = { quality: 'BLURRED' };
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('RETAKE');
    expect(checkOf(result, 'GST_DOCUMENT')).toMatchObject({ outcome: 'FAIL', evidence: { problem: 'BLURRED' } });
    expect(checkOf(result, 'SIGNATORY_VALID').outcome).toBe('PASS');
    expect(checkOf(result, 'ADDRESS_AGE').outcome).toBe('PASS');
    expect(checkOf(result, 'GST_NAME').outcome).toBe('SKIPPED');
  });

  it.each(['signatory', 'addressProof'] as const)('asks for a missing %s', (slot) => {
    const result = assessWith((input) => {
      input[slot] = { quality: 'MISSING' };
    });
    expect(result.verdict).toBe('RETAKE');
  });

  it('asks for a document uploaded in the wrong slot, naming what it found', () => {
    const result = assessWith((input) => {
      input.addressProof = { quality: 'WRONG_TYPE', detected: 'SIGNATORY_ID' };
    });
    expect(result.verdict).toBe('RETAKE');
    expect(checkOf(result, 'ADDRESS_DOCUMENT').evidence).toMatchObject({ problem: 'WRONG_TYPE', detected: 'SIGNATORY_ID' });
  });

  it('requires the GST certificate only when the bundle needs one', () => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      input.gst = { quality: 'MISSING' };
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'GST_DOCUMENT').outcome).toBe('SKIPPED');
  });

  it('falls back to the application business name when there is no GST certificate', () => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      input.gst = { quality: 'MISSING' };
      input.gstLookup = { status: 'NOT_RUN' };
      input.businessName = 'Other Traders';
    });
    expect(failedIds(result)).toEqual(['UDYAM_NAME', 'BILL_NAME', 'SIGNATORY_BUSINESS']);
  });
});

describe('a bad GSTIN on a bundle that needs none', () => {
  it('still asks the owner to check the number first', () => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      if (input.gst.quality === 'OK') input.gst.fields.gstin = '08YKZXS8189L1Z0';
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('NEEDS_CONFIRMATION');
  });

  it('counts as no GSTIN once confirmed, rather than rejecting the owner', () => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      input.gstinConfirmedByOwner = true;
      if (input.gst.quality === 'OK') input.gst.fields.gstin = '08YKZXS8189L1Z0';
      input.gstLookup = { status: 'NOT_RUN' };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'GST_FORMAT')).toMatchObject({ outcome: 'FAIL', severity: 'ADVISORY' });
  });

  it('counts a number the registry does not hold as no GSTIN too', () => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      input.gstinConfirmedByOwner = true;
      input.gstLookup = { status: 'NOT_FOUND' };
    });
    expect(result.verdict).toBe('VERIFIED');
  });
});

describe('a registry outage on a bundle that needs no GSTIN', () => {
  it('does not hold the verdict', () => {
    const result = assessWith((input) => {
      input.bundleNeedsGstin = false;
      input.gstLookup = { status: 'UNAVAILABLE' };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'GST_NAME').outcome).toBe('PENDING');
  });
});

describe('a registry outage', () => {
  it('holds the verdict as pending, and keeps document results', () => {
    const result = assessWith((input) => {
      input.gstLookup = { status: 'UNAVAILABLE' };
      input.udyamLookup = { status: 'UNAVAILABLE' };
    });
    expect(result.verdict).toBe('VERIFICATION_PENDING');
    expect(checkOf(result, 'GST_FOUND').outcome).toBe('PENDING');
    expect(checkOf(result, 'SIGNATORY_VALID').outcome).toBe('PASS');
  });

  it('reports a real failure ahead of the outage', () => {
    const result = assessWith((input) => {
      input.gstLookup = { status: 'UNAVAILABLE' };
      if (input.addressProof.quality === 'OK') input.addressProof.fields.billDate = '2025-01-01';
    });
    expect(result.verdict).toBe('RETAKE');
  });

  it('does not hold the verdict for an optional Udyam lookup', () => {
    const result = assessWith((input) => {
      input.udyamLookup = { status: 'UNAVAILABLE' };
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(checkOf(result, 'UDYAM_PRESENT').outcome).toBe('PENDING');
  });
});

describe('verdict order', () => {
  it('reports a rejection over anything else', () => {
    const result = assessWith((input) => {
      input.gstLookup = { status: 'FOUND', record: { ...GST_RECORD, status: 'Cancelled' } };
      input.signatory = { quality: 'MISSING' };
      input.contactName = 'Fatima Menon';
    });
    expect(result.verdict).toBe('REJECTED');
  });

  it('reports a retake over manual review', () => {
    const result = assessWith((input) => {
      input.contactName = 'Fatima Menon';
      if (input.addressProof.quality === 'OK') input.addressProof.fields.billDate = '2025-01-01';
    });
    expect(result.verdict).toBe('RETAKE');
  });
});

describe('prepareGstin', () => {
  it('gives a value ready to look up when it passes', () => {
    expect(prepareGstin('27XUIXGO767D1ZP')).toEqual({ value: GSTIN, readyForLookup: true, suggestion: null, repaired: true });
  });

  it('holds back a value that fails, with any suggestion', () => {
    expect(prepareGstin('27QHIXK0658U1ZL')).toEqual({
      value: '27QHIXK0658U1ZL',
      readyForLookup: false,
      suggestion: '27QHJXK0658U1ZL',
      repaired: false,
    });
  });
});

describe('requiredDocuments', () => {
  it('asks for only an ID and address proof when no GSTIN is involved', () => {
    expect(requiredDocuments({ bundleNeedsGstin: false, ownerGaveGstin: false })).toEqual(['SIGNATORY_ID', 'ADDRESS_PROOF']);
  });

  it('adds the GST certificate when the bundle needs one', () => {
    expect(requiredDocuments({ bundleNeedsGstin: true, ownerGaveGstin: false })).toContain('GST_CERTIFICATE');
  });

  it('adds the GST certificate when the owner gives a GSTIN anyway', () => {
    expect(requiredDocuments({ bundleNeedsGstin: false, ownerGaveGstin: true })).toContain('GST_CERTIFICATE');
  });

  it('never makes the Udyam certificate required', () => {
    expect(requiredDocuments({ bundleNeedsGstin: true, ownerGaveGstin: true })).not.toContain('UDYAM_CERTIFICATE');
  });
});
