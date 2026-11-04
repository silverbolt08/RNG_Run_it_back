import type { GstRecord, RegistryLookup, UdyamRecord } from '../../../domain/kyc/assess-kyc';

/**
 * Registries as a remote service, so a real provider can replace the mock. Every failure comes
 * back as UNAVAILABLE rather than an exception, because an outage must save progress, not fail.
 */
export interface RegistryClient {
  lookupGstin(gstin: string): Promise<RegistryLookup<GstRecord>>;
  lookupUdyam(udyamNumber: string): Promise<RegistryLookup<UdyamRecord>>;
}
