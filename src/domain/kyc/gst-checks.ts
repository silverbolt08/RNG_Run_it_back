import { gstinStateName, isValidGstinChecksum, repairGstinByPosition, suggestGstinLookalike } from './gstin';
import { documentProblem, lookupCheck, make, skipped, unreadableField } from './kyc-check-helpers';
import type { KycCheck, KycFailAction, KycInput, KycSeverity } from './kyc-types';
import { isSameAddress, isSameLegalName, isSameName } from './names';

export type PreparedGstin = {
  value: string;
  readyForLookup: boolean;
  suggestion: string | null;
  repaired: boolean;
};

/** Cleans what OCR read, before any registry lookup. A value that fails never reaches the registry. */
export function prepareGstin(raw: string): PreparedGstin {
  const repair = repairGstinByPosition(raw);
  return {
    value: repair.value,
    readyForLookup: repair.checksumOk && isValidGstinChecksum(repair.value),
    suggestion: repair.checksumOk ? null : suggestGstinLookalike(repair.value),
    repaired: repair.checksumOk && repair.changes.length > 0,
  };
}

/** With a bundle that needs no GSTIN, a bad one simply counts as no GSTIN. */
function gstinFaultImpact(input: KycInput): { severity: KycSeverity; onFail: KycFailAction } {
  return input.bundleNeedsGstin ? { severity: 'HARD', onFail: 'REJECTED' } : { severity: 'ADVISORY', onFail: 'NONE' };
}

export function gstChecks(input: KycInput): KycCheck[] {
  const { gst, gstLookup } = input;
  const skippedAfterDocument: KycCheck[] = [
    skipped('GST_FORMAT', 'HARD', 'REJECTED'),
    skipped('GST_FOUND', 'HARD', 'REJECTED'),
    skipped('GST_STATUS', 'HARD', 'REJECTED'),
    skipped('GST_NAME', 'HARD', 'MANUAL_REVIEW'),
    skipped('GST_ADDRESS', 'SOFT', 'MANUAL_REVIEW'),
    skipped('GST_STATE', 'SOFT', 'MANUAL_REVIEW'),
  ];

  if (gst.quality !== 'OK') {
    const documentCheck = input.bundleNeedsGstin
      ? make('GST_DOCUMENT', 'HARD', 'RETAKE', false, documentProblem(gst))
      : skipped('GST_DOCUMENT', 'HARD', 'RETAKE');
    return [documentCheck, ...skippedAfterDocument];
  }

  const { fields } = gst;
  const prepared = prepareGstin(fields.gstin);
  const impact = gstinFaultImpact(input);
  const nameSeverity: KycSeverity = input.bundleNeedsGstin ? 'HARD' : 'SOFT';

  const formatCheck = gstFormatCheck(input, prepared);
  const foundCheck: KycCheck =
    gstLookup.status === 'NOT_FOUND'
      ? input.gstinConfirmedByOwner
        ? make('GST_FOUND', impact.severity, impact.onFail, false)
        : make('GST_FOUND', 'HARD', 'NEEDS_CONFIRMATION', false, { read: prepared.value })
      : lookupCheck(gstLookup, 'GST_FOUND', impact.severity, impact.onFail, () =>
          make('GST_FOUND', impact.severity, impact.onFail, true),
        );

  return [
    make('GST_DOCUMENT', 'HARD', 'RETAKE', true),
    formatCheck,
    foundCheck,
    lookupCheck(gstLookup, 'GST_STATUS', impact.severity, impact.onFail, (record) =>
      make('GST_STATUS', impact.severity, impact.onFail, record.status === 'Active', { status: record.status }),
    ),
    // Soft when the bundle needs no GSTIN, so a registry outage can't hold up that owner.
    lookupCheck(gstLookup, 'GST_NAME', nameSeverity, 'MANUAL_REVIEW', (record) => {
      const legalOk = isSameLegalName(fields.legalName, record.legalName);
      const tradeOk = isSameName(fields.tradeName, record.tradeName);
      return make(
        'GST_NAME',
        nameSeverity,
        'MANUAL_REVIEW',
        legalOk && tradeOk,
        legalOk && tradeOk ? {} : { onDocument: legalOk ? fields.tradeName : fields.legalName },
      );
    }),
    lookupCheck(gstLookup, 'GST_ADDRESS', 'SOFT', 'MANUAL_REVIEW', (record) =>
      make('GST_ADDRESS', 'SOFT', 'MANUAL_REVIEW', isSameAddress(fields.address, record.address)),
    ),
    gstStateCheck(prepared, fields.address),
  ];
}

function gstFormatCheck(input: KycInput, prepared: PreparedGstin): KycCheck {
  if (prepared.value === '') return unreadableField('GST_FORMAT', 'HARD', 'gstin');
  if (prepared.readyForLookup) {
    return make('GST_FORMAT', 'HARD', 'REJECTED', true, prepared.repaired ? { repaired: 'true', read: prepared.value } : {});
  }
  if (input.gstinConfirmedByOwner) {
    const impact = gstinFaultImpact(input);
    return make('GST_FORMAT', impact.severity, impact.onFail, false, { read: prepared.value });
  }
  // OCR misreads and real faults both fail the checksum and look identical, so the owner decides first.
  return make('GST_FORMAT', 'HARD', 'NEEDS_CONFIRMATION', false, {
    read: prepared.value,
    ...(prepared.suggestion ? { suggestion: prepared.suggestion } : {}),
  });
}

function gstStateCheck(prepared: PreparedGstin, address: string): KycCheck {
  if (!prepared.readyForLookup) return skipped('GST_STATE', 'SOFT', 'MANUAL_REVIEW');
  const state = gstinStateName(prepared.value);
  const squashed = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');
  return make('GST_STATE', 'SOFT', 'MANUAL_REVIEW', state !== null && squashed(address).includes(squashed(state)));
}
