import { describe, expect, it } from 'vitest';
import { gstinStateName, isValidGstinChecksum, repairGstinByPosition } from '@/domain/kyc/gstin';
import { isValidUdyamFormat, udyamStateName } from '@/domain/kyc/udyam';
import { readPackCsv } from '../helpers/data-pack';

const gstRegistry = readPackCsv('mock_gstin_registry.csv');
const udyamRegistry = readPackCsv('mock_udyam_registry.csv');
const leads = readPackCsv('smb_leads.csv');

describe('GST registry', () => {
  it('has 3,534 records', () => {
    expect(gstRegistry).toHaveLength(3534);
  });

  it('has the expected status counts', () => {
    const count = (status: string) => gstRegistry.filter((row) => row.status === status).length;
    expect([count('Active'), count('Cancelled'), count('Suspended')]).toEqual([3266, 167, 101]);
  });

  it('passes the checksum on every GSTIN', () => {
    expect(gstRegistry.filter((row) => !isValidGstinChecksum(row.gstin ?? ''))).toEqual([]);
  });

  it('matches every GSTIN state code to its state', () => {
    expect(gstRegistry.filter((row) => gstinStateName(row.gstin ?? '') !== row.state)).toEqual([]);
  });

  // A repair that changed a good value would corrupt a clean read.
  it('leaves every valid GSTIN untouched by repair', () => {
    const changed = gstRegistry.filter((row) => {
      const repair = repairGstinByPosition(row.gstin ?? '');
      return repair.value !== row.gstin || repair.changes.length > 0;
    });
    expect(changed).toEqual([]);
  });

  it('finds every lead GSTIN in the registry, and only those', () => {
    const registered = new Set(gstRegistry.map((row) => row.gstin));
    const withGstin = leads.filter((lead) => lead.has_gstin === 'Y');
    expect(withGstin).toHaveLength(3534);
    expect(withGstin.filter((lead) => !registered.has(lead.gstin))).toEqual([]);
  });
});

describe('Udyam registry', () => {
  it('has 2,723 records', () => {
    expect(udyamRegistry).toHaveLength(2723);
  });

  it('passes the format on every number', () => {
    expect(udyamRegistry.filter((row) => !isValidUdyamFormat(row.udyam_number ?? ''))).toEqual([]);
  });

  it('matches every state code to its state', () => {
    expect(udyamRegistry.filter((row) => udyamStateName(row.udyam_number ?? '') !== row.state)).toEqual([]);
  });

  it('finds every lead Udyam number in the registry', () => {
    const registered = new Set(udyamRegistry.map((row) => row.udyam_number));
    const withUdyam = leads.filter((lead) => lead.has_udyam === 'Y');
    expect(withUdyam).toHaveLength(2723);
    expect(withUdyam.filter((lead) => !registered.has(lead.udyam_number))).toEqual([]);
  });
});
