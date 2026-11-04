import type { GstRecord, RegistryLookup, UdyamRecord } from '../../../domain/kyc/assess-kyc';
import type { RegistryClient } from './registry-client';

export type RegistryBackend = {
  findGstin(gstin: string): Promise<GstRecord | null>;
  findUdyam(udyamNumber: string): Promise<UdyamRecord | null>;
  isOutage(): Promise<boolean>;
};

export type RegistryClientOptions = { timeoutMs: number; retries: number };

const DEFAULT_OPTIONS: RegistryClientOptions = { timeoutMs: 3000, retries: 1 };

class RegistryTimeoutError extends Error {}

/** Answers from the seeded tables, while behaving like a network call that can time out or fail. */
export function createMockRegistryClient(
  backend: RegistryBackend,
  options: Partial<RegistryClientOptions> = {},
): RegistryClient {
  const { timeoutMs, retries } = { ...DEFAULT_OPTIONS, ...options };

  const attempt = async <T>(find: () => Promise<T | null>): Promise<RegistryLookup<T>> => {
    if (await backend.isOutage()) return { status: 'UNAVAILABLE' };

    for (let tries = 0; tries <= retries; tries++) {
      try {
        const record = await withTimeout(find(), timeoutMs);
        return record === null ? { status: 'NOT_FOUND' } : { status: 'FOUND', record };
      } catch {
        // Falls through to the next attempt. The owner sees "pending", never the cause.
      }
    }
    return { status: 'UNAVAILABLE' };
  };

  return {
    lookupGstin: (gstin) => attempt<GstRecord>(() => backend.findGstin(gstin)),
    lookupUdyam: (number) => attempt<UdyamRecord>(() => backend.findUdyam(number)),
  };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RegistryTimeoutError()), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
