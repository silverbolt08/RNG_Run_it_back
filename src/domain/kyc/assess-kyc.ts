import type { DocumentType } from './documents';
import { addressChecks, signatoryChecks, udyamChecks } from './document-checks';
import { gstChecks, prepareGstin } from './gst-checks';
import type { KycAssessment, KycCheck, KycFailAction, KycInput, KycVerdict } from './kyc-types';

export { prepareGstin };
export type { PreparedGstin } from './gst-checks';
export type { GstFields, UdyamFields, SignatoryFields, AddressProofFields } from './documents';
export type {
  DocumentSlot,
  GstRecord,
  KycAssessment,
  KycCheck,
  KycCheckId,
  KycInput,
  KycVerdict,
  RegistryLookup,
  UdyamRecord,
} from './kyc-types';

/**
 * The one place a failure becomes a verdict. Ordered from most to least final, so the owner
 * always hears the thing that matters most. A verdict never comes from the LLM.
 */
const VERDICT_ORDER: ReadonlyArray<{ action: KycFailAction; verdict: KycVerdict }> = [
  { action: 'REJECTED', verdict: 'REJECTED' },
  { action: 'RETAKE', verdict: 'RETAKE' },
  { action: 'NEEDS_CONFIRMATION', verdict: 'NEEDS_CONFIRMATION' },
];

export function assessKyc(input: KycInput): KycAssessment {
  const checks = [...gstChecks(input), ...udyamChecks(input), ...addressChecks(input), ...signatoryChecks(input)];
  return { verdict: verdictFor(checks), checks };
}

/** Asks only for what this order needs. The Udyam certificate is never required. */
export function requiredDocuments(options: { bundleNeedsGstin: boolean; ownerGaveGstin: boolean }): DocumentType[] {
  const needsGst = options.bundleNeedsGstin || options.ownerGaveGstin;
  return needsGst ? ['GST_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF'] : ['SIGNATORY_ID', 'ADDRESS_PROOF'];
}

function verdictFor(checks: readonly KycCheck[]): KycVerdict {
  const failed = checks.filter((check) => check.outcome === 'FAIL');

  for (const { action, verdict } of VERDICT_ORDER) {
    if (failed.some((check) => check.onFail === action)) return verdict;
  }

  const waiting = checks.some((check) => check.outcome === 'PENDING' && check.severity === 'HARD');
  if (waiting) return 'VERIFICATION_PENDING';

  return failed.some((check) => check.onFail === 'MANUAL_REVIEW') ? 'MANUAL_REVIEW' : 'VERIFIED';
}
