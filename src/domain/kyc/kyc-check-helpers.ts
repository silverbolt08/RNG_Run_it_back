import type { DocumentType } from './documents';
import type {
  DocumentSlot,
  KycCheck,
  KycCheckId,
  KycFailAction,
  KycInput,
  KycSeverity,
  RegistryLookup,
} from './kyc-types';

const MS_PER_DAY = 86_400_000;

export function make(
  id: KycCheckId,
  severity: KycSeverity,
  onFail: KycFailAction,
  passed: boolean,
  evidence: Record<string, string> = {},
): KycCheck {
  return { id, severity, onFail, outcome: passed ? 'PASS' : 'FAIL', evidence };
}

export const skipped = (id: KycCheckId, severity: KycSeverity, onFail: KycFailAction): KycCheck => ({
  id,
  severity,
  onFail,
  outcome: 'SKIPPED',
  evidence: {},
});

export const pending = (id: KycCheckId, severity: KycSeverity, onFail: KycFailAction): KycCheck => ({
  id,
  severity,
  onFail,
  outcome: 'PENDING',
  evidence: {},
});

export const unreadableField = (id: KycCheckId, severity: KycSeverity, field: string): KycCheck =>
  make(id, severity, 'NEEDS_CONFIRMATION', false, { missing: field });

export function documentProblem<T>(slot: DocumentSlot<T>): Record<string, string> {
  if (slot.quality === 'WRONG_TYPE') {
    const detected: DocumentType | null = slot.detected;
    return detected ? { problem: 'WRONG_TYPE', detected } : { problem: 'WRONG_TYPE' };
  }
  return { problem: slot.quality };
}

export function lookupCheck<T>(
  lookup: RegistryLookup<T>,
  id: KycCheckId,
  severity: KycSeverity,
  onFail: KycFailAction,
  compare: (record: T) => KycCheck,
): KycCheck {
  if (lookup.status === 'FOUND') return compare(lookup.record);
  if (lookup.status === 'UNAVAILABLE') return pending(id, severity, onFail);
  return skipped(id, severity, onFail);
}

export function expectedBusinessName(input: KycInput): string | null {
  if (input.gst.quality === 'OK' && input.gst.fields.tradeName !== '') return input.gst.fields.tradeName;
  if (input.gstLookup.status === 'FOUND') return input.gstLookup.record.tradeName;
  return input.businessName;
}

export function isoDateToDays(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(time);
  if (roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null;
  return time / MS_PER_DAY;
}
