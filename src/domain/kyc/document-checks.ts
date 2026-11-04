import { expectedBusinessName, documentProblem, isoDateToDays, lookupCheck, make, skipped, unreadableField } from './kyc-check-helpers';
import type { KycCheck, KycCheckId, KycInput } from './kyc-types';
import { isSameAddress, isSameName, parseProprietorName } from './names';
import { isValidUdyamFormat } from './udyam';

// Per the data pack README, address proof must be no older than 90 days.
const MAX_BILL_AGE_DAYS = 90;

export function udyamChecks(input: KycInput): KycCheck[] {
  const { udyam, udyamLookup } = input;
  const present = udyamPresentCheck(input);

  if (udyam.quality !== 'OK') {
    return [
      present,
      skipped('UDYAM_NAME', 'SOFT', 'MANUAL_REVIEW'),
      skipped('UDYAM_DATE', 'ADVISORY', 'NONE'),
      skipped('UDYAM_ACTIVITY', 'ADVISORY', 'NONE'),
    ];
  }

  const { fields } = udyam;
  const expectedName = expectedBusinessName(input);
  return [
    present,
    expectedName === null
      ? skipped('UDYAM_NAME', 'SOFT', 'MANUAL_REVIEW')
      : make('UDYAM_NAME', 'SOFT', 'MANUAL_REVIEW', isSameName(fields.enterpriseName, expectedName), {
          onDocument: fields.enterpriseName,
        }),
    lookupCheck(udyamLookup, 'UDYAM_DATE', 'ADVISORY', 'NONE', (record) =>
      make('UDYAM_DATE', 'ADVISORY', 'NONE', fields.registrationDate === record.dateOfRegistration),
    ),
    lookupCheck(udyamLookup, 'UDYAM_ACTIVITY', 'ADVISORY', 'NONE', (record) =>
      make('UDYAM_ACTIVITY', 'ADVISORY', 'NONE', isSameName(fields.majorActivity, record.majorActivity)),
    ),
  ];
}

// Optional, so its absence alone never stops a sale. A certificate that is present but wrong gets a second look.
function udyamPresentCheck(input: KycInput): KycCheck {
  const { udyam, udyamLookup } = input;
  const id: KycCheckId = 'UDYAM_PRESENT';

  if (udyam.quality === 'OK') {
    const number = udyam.fields.udyamNumber;
    if (number === '') return make(id, 'SOFT', 'MANUAL_REVIEW', false, { problem: 'NO_NUMBER' });
    if (!isValidUdyamFormat(number)) return make(id, 'SOFT', 'MANUAL_REVIEW', false, { problem: 'BAD_FORMAT', read: number });
  }

  const source = udyam.quality === 'OK' ? 'CERTIFICATE' : 'REGISTRY';
  if (udyamLookup.status === 'NOT_FOUND') return make(id, 'SOFT', 'MANUAL_REVIEW', false, { problem: 'NOT_FOUND' });
  return lookupCheck(udyamLookup, id, 'SOFT', 'MANUAL_REVIEW', () => make(id, 'SOFT', 'MANUAL_REVIEW', true, { source }));
}

export function addressChecks(input: KycInput): KycCheck[] {
  const { addressProof } = input;
  if (addressProof.quality !== 'OK') {
    return [
      make('ADDRESS_DOCUMENT', 'HARD', 'RETAKE', false, documentProblem(addressProof)),
      skipped('ADDRESS_MATCH', 'HARD', 'RETAKE'),
      skipped('ADDRESS_AGE', 'HARD', 'RETAKE'),
      skipped('BILL_NAME', 'HARD', 'MANUAL_REVIEW'),
    ];
  }

  const { fields } = addressProof;
  const gstAddress = input.gst.quality === 'OK'
    ? input.gst.fields.address
    : input.gstLookup.status === 'FOUND'
      ? input.gstLookup.record.address
      : null;
  const expectedName = expectedBusinessName(input);

  return [
    make('ADDRESS_DOCUMENT', 'HARD', 'RETAKE', true),
    gstAddress === null
      ? skipped('ADDRESS_MATCH', 'HARD', 'RETAKE')
      : fields.supplyAddress === ''
        ? unreadableField('ADDRESS_MATCH', 'HARD', 'supplyAddress')
        : make('ADDRESS_MATCH', 'HARD', 'RETAKE', isSameAddress(fields.supplyAddress, gstAddress)),
    billAgeCheck(fields.billDate, input.today),
    expectedName === null
      ? skipped('BILL_NAME', 'HARD', 'MANUAL_REVIEW')
      : fields.billedTo === ''
        ? unreadableField('BILL_NAME', 'HARD', 'billedTo')
        : make('BILL_NAME', 'HARD', 'MANUAL_REVIEW', isSameName(fields.billedTo, expectedName), {
            onDocument: fields.billedTo,
          }),
  ];
}

function billAgeCheck(billDate: string, today: string): KycCheck {
  const bill = isoDateToDays(billDate);
  const now = isoDateToDays(today);
  if (bill === null) return unreadableField('ADDRESS_AGE', 'HARD', 'billDate');
  if (now === null) throw new Error(`Invalid business date: ${today}`);

  const age = now - bill;
  return make('ADDRESS_AGE', 'HARD', 'RETAKE', age >= 0 && age <= MAX_BILL_AGE_DAYS, {
    ageDays: String(age),
    maxAgeDays: String(MAX_BILL_AGE_DAYS),
  });
}

export function signatoryChecks(input: KycInput): KycCheck[] {
  const { signatory } = input;
  if (signatory.quality !== 'OK') {
    return [
      make('SIGNATORY_DOCUMENT', 'HARD', 'RETAKE', false, documentProblem(signatory)),
      skipped('SIGNATORY_NAME', 'HARD', 'MANUAL_REVIEW'),
      skipped('SIGNATORY_VALID', 'HARD', 'RETAKE'),
      skipped('SIGNATORY_BUSINESS', 'HARD', 'MANUAL_REVIEW'),
    ];
  }

  const { fields } = signatory;
  const expectedName = expectedBusinessName(input);
  return [
    make('SIGNATORY_DOCUMENT', 'HARD', 'RETAKE', true),
    signatoryNameCheck(input, fields.name),
    signatoryValidCheck(fields.validTill, input.today),
    expectedName === null
      ? skipped('SIGNATORY_BUSINESS', 'HARD', 'MANUAL_REVIEW')
      : fields.business === ''
        ? unreadableField('SIGNATORY_BUSINESS', 'HARD', 'business')
        : make('SIGNATORY_BUSINESS', 'HARD', 'MANUAL_REVIEW', isSameName(fields.business, expectedName), {
            onDocument: fields.business,
          }),
  ];
}

function signatoryNameCheck(input: KycInput, name: string): KycCheck {
  if (name === '') return unreadableField('SIGNATORY_NAME', 'HARD', 'name');

  const legalName =
    input.gst.quality === 'OK'
      ? input.gst.fields.legalName
      : input.gstLookup.status === 'FOUND'
        ? input.gstLookup.record.legalName
        : '';
  const proprietor = parseProprietorName(legalName)?.person ?? null;

  const matchesContact = input.contactName === null || isSameName(name, input.contactName);
  const matchesProprietor = proprietor === null || isSameName(name, proprietor);
  return make('SIGNATORY_NAME', 'HARD', 'MANUAL_REVIEW', matchesContact && matchesProprietor, { onDocument: name });
}

function signatoryValidCheck(validTill: string, today: string): KycCheck {
  const until = isoDateToDays(validTill);
  const now = isoDateToDays(today);
  if (until === null) return unreadableField('SIGNATORY_VALID', 'HARD', 'validTill');
  if (now === null) throw new Error(`Invalid business date: ${today}`);
  return make('SIGNATORY_VALID', 'HARD', 'RETAKE', until > now, { validTill });
}
