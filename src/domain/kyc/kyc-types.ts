import type { AddressProofFields, DocumentType, GstFields, SignatoryFields, UdyamFields } from './documents';

export type GstRecord = {
  gstin: string;
  legalName: string;
  tradeName: string;
  address: string;
  status: 'Active' | 'Cancelled' | 'Suspended';
};

export type UdyamRecord = {
  udyamNumber: string;
  enterpriseName: string;
  majorActivity: string;
  city: string;
  state: string;
  dateOfRegistration: string;
};

export type RegistryLookup<T> =
  | { status: 'FOUND'; record: T }
  | { status: 'NOT_FOUND' }
  | { status: 'UNAVAILABLE' }
  | { status: 'NOT_RUN' };

export type DocumentSlot<T> =
  | { quality: 'OK'; fields: T }
  | { quality: 'BLURRED' }
  | { quality: 'UNREADABLE' }
  | { quality: 'MISSING' }
  | { quality: 'WRONG_TYPE'; detected: DocumentType | null };

export type KycInput = {
  /** The business date, as YYYY-MM-DD, passed in so this code never reads the clock. */
  today: string;
  contactName: string | null;
  businessName: string | null;
  bundleNeedsGstin: boolean;
  /** True once the owner has checked the GSTIN against their certificate. */
  gstinConfirmedByOwner: boolean;
  gst: DocumentSlot<GstFields>;
  udyam: DocumentSlot<UdyamFields>;
  signatory: DocumentSlot<SignatoryFields>;
  addressProof: DocumentSlot<AddressProofFields>;
  gstLookup: RegistryLookup<GstRecord>;
  udyamLookup: RegistryLookup<UdyamRecord>;
};

export type KycCheckId =
  | 'GST_DOCUMENT'
  | 'GST_FORMAT'
  | 'GST_FOUND'
  | 'GST_STATUS'
  | 'GST_NAME'
  | 'GST_ADDRESS'
  | 'GST_STATE'
  | 'UDYAM_PRESENT'
  | 'UDYAM_NAME'
  | 'UDYAM_DATE'
  | 'UDYAM_ACTIVITY'
  | 'ADDRESS_DOCUMENT'
  | 'ADDRESS_MATCH'
  | 'ADDRESS_AGE'
  | 'BILL_NAME'
  | 'SIGNATORY_DOCUMENT'
  | 'SIGNATORY_NAME'
  | 'SIGNATORY_VALID'
  | 'SIGNATORY_BUSINESS';

/**
 * HARD and SOFT checks can change the verdict. ADVISORY checks are only recorded: Udyam dates and
 * activity differ from the registry even on clean applicants, so acting on them would stop everyone.
 */
export type KycSeverity = 'HARD' | 'SOFT' | 'ADVISORY';

export type KycOutcome = 'PASS' | 'FAIL' | 'SKIPPED' | 'PENDING';

/** What a failed check asks for. */
export type KycFailAction = 'REJECTED' | 'RETAKE' | 'NEEDS_CONFIRMATION' | 'MANUAL_REVIEW' | 'NONE';

export type KycCheck = {
  id: KycCheckId;
  severity: KycSeverity;
  outcome: KycOutcome;
  onFail: KycFailAction;
  /**
   * Values from the owner's own documents, for building their message. Never registry values,
   * so it can't reveal which record would have matched. Never log this.
   */
  evidence: Record<string, string>;
};

export type KycVerdict =
  | 'VERIFIED'
  | 'RETAKE'
  | 'NEEDS_CONFIRMATION'
  | 'VERIFICATION_PENDING'
  | 'MANUAL_REVIEW'
  | 'REJECTED';

export type KycAssessment = { verdict: KycVerdict; checks: KycCheck[] };
