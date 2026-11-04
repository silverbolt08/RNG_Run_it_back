import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SegmentCode } from '@/domain/catalogue/catalogue';
import type { GstinStatus } from '@/domain/eligibility/eligibility';
import { parseCsv } from '@/lib/csv';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve('YTL_TrackA_Udyam_Digital_Data');

export const SEGMENT_CODE: Readonly<Record<string, SegmentCode>> = {
  'Micro retail & services': 'micro',
  'Professional offices': 'prof',
  'Small multi-site businesses': 'multi',
  'Small manufacturers': 'mfg',
};

/** Fails loudly, because a regression test that skips itself proves nothing. */
export function readPackFile(name: string): string {
  const file = path.join(DATA_DIR, name);
  if (!existsSync(file)) {
    throw new Error(`Data pack file not found: ${file}. Set DATA_DIR to the folder holding the data pack.`);
  }
  return readFileSync(file, 'utf8');
}

export function readPackCsv(name: string): Array<Record<string, string>> {
  return parseCsv(readPackFile(name));
}

export function gstinStatusFor(
  lead: Record<string, string>,
  registry: ReadonlyMap<string, string>,
): GstinStatus {
  if (lead.has_gstin !== 'Y') return 'NONE';
  const status = registry.get(lead.gstin ?? '');
  if (status === 'Active') return 'ACTIVE';
  if (status === 'Cancelled') return 'CANCELLED';
  if (status === 'Suspended') return 'SUSPENDED';
  throw new Error(`Lead ${lead.lead_id} has a GSTIN that is not in the registry`);
}
