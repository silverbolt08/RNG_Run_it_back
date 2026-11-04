import { describe, expect, it } from 'vitest';
import type { GstRecord, UdyamRecord } from '@/domain/kyc/assess-kyc';
import { createMockRegistryClient, type RegistryBackend } from '@/server/adapters/registry/mock-registry-client';

const GST_RECORD: GstRecord = {
  gstin: '32TTNXB7384T1ZW',
  legalName: 'Balaji Dental Care LLP',
  tradeName: 'Balaji Dental Care LLP',
  address: 'Shop/Unit 164, Station Road, Kochi, Kerala - 289398',
  status: 'Active',
};

const UDYAM_RECORD: UdyamRecord = {
  udyamNumber: 'UDYAM-KL-00-3078801',
  enterpriseName: 'Balaji Dental Care LLP',
  majorActivity: 'Services',
  city: 'Kochi',
  state: 'Kerala',
  dateOfRegistration: '2023-12-25',
};

function backend(overrides: Partial<RegistryBackend> = {}): RegistryBackend {
  return {
    findGstin: async (gstin) => (gstin === GST_RECORD.gstin ? GST_RECORD : null),
    findUdyam: async (number) => (number === UDYAM_RECORD.udyamNumber ? UDYAM_RECORD : null),
    isOutage: async () => false,
    ...overrides,
  };
}

describe('RegistryClient', () => {
  it('returns a found GST record', async () => {
    const client = createMockRegistryClient(backend());
    await expect(client.lookupGstin(GST_RECORD.gstin)).resolves.toEqual({ status: 'FOUND', record: GST_RECORD });
  });

  it('returns a found Udyam record', async () => {
    const client = createMockRegistryClient(backend());
    await expect(client.lookupUdyam(UDYAM_RECORD.udyamNumber)).resolves.toEqual({ status: 'FOUND', record: UDYAM_RECORD });
  });

  it('says when a number is not in the registry', async () => {
    const client = createMockRegistryClient(backend());
    await expect(client.lookupGstin('33AAAAA0000A1Z5')).resolves.toEqual({ status: 'NOT_FOUND' });
    await expect(client.lookupUdyam('UDYAM-KL-00-0000000')).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  it('reports the registry unavailable during a simulated outage, without touching the records', async () => {
    let touched = false;
    const client = createMockRegistryClient(
      backend({
        isOutage: async () => true,
        findGstin: async () => {
          touched = true;
          return GST_RECORD;
        },
      }),
    );
    await expect(client.lookupGstin(GST_RECORD.gstin)).resolves.toEqual({ status: 'UNAVAILABLE' });
    await expect(client.lookupUdyam(UDYAM_RECORD.udyamNumber)).resolves.toEqual({ status: 'UNAVAILABLE' });
    expect(touched).toBe(false);
  });

  it('reports unavailable when a lookup outlasts the timeout', async () => {
    const client = createMockRegistryClient(
      backend({ findGstin: () => new Promise(() => undefined) }),
      { timeoutMs: 20, retries: 0 },
    );
    await expect(client.lookupGstin(GST_RECORD.gstin)).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('retries once after a failure', async () => {
    let calls = 0;
    const client = createMockRegistryClient(
      backend({
        findGstin: async () => {
          calls += 1;
          if (calls === 1) throw new Error('transient');
          return GST_RECORD;
        },
      }),
      { timeoutMs: 100, retries: 1 },
    );
    await expect(client.lookupGstin(GST_RECORD.gstin)).resolves.toEqual({ status: 'FOUND', record: GST_RECORD });
    expect(calls).toBe(2);
  });

  it('reports unavailable when the retry also fails', async () => {
    const client = createMockRegistryClient(
      backend({
        findUdyam: async () => {
          throw new Error('down');
        },
      }),
      { timeoutMs: 100, retries: 1 },
    );
    await expect(client.lookupUdyam(UDYAM_RECORD.udyamNumber)).resolves.toEqual({ status: 'UNAVAILABLE' });
  });
});
