import { afterEach, describe, expect, it } from 'vitest';
import { assessKyc, type KycInput } from '@/domain/kyc/assess-kyc';
import { createClockFromEnv, createFixedClock, createSystemClock } from '@/lib/clock';

describe('Clock', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('reads the business date from APP_TODAY, separately from system time', () => {
    const clock = createClockFromEnv({ APP_TODAY: '2026-07-15' });
    expect(clock.today()).toBe('2026-07-15');
    expect(clock.now().getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('falls back to the data pack date when APP_TODAY is unset', () => {
    expect(createClockFromEnv({}).today()).toBe('2026-07-15');
  });

  it.each(['15-07-2026', '2026-7-15', '2026-02-30', 'today', ''])('rejects the malformed date %j', (value) => {
    expect(() => createSystemClock(value)).toThrow(/APP_TODAY/);
  });

  it('gives system time from now(), not the business date', () => {
    const clock = createFixedClock({ today: '2026-07-15', now: '2026-11-04T10:00:00.000Z' });
    expect(clock.today()).toBe('2026-07-15');
    expect(clock.now().toISOString()).toBe('2026-11-04T10:00:00.000Z');
  });

  it.each(['UTC', 'Asia/Kolkata', 'America/New_York'])('keeps the business date stable in the %s time zone', (zone) => {
    process.env.TZ = zone;
    // 18:45 UTC is already the next day in IST, and must not move the business date.
    const clock = createFixedClock({ today: '2026-07-15', now: '2026-07-15T18:45:00.000Z' });
    expect(clock.today()).toBe('2026-07-15');
  });

  describe.each(['UTC', 'Asia/Kolkata'])('bill age boundaries in %s', (zone) => {
    const base: KycInput = {
      today: '2026-07-15',
      contactName: null,
      businessName: 'Test Traders',
      bundleNeedsGstin: false,
      gstinConfirmedByOwner: false,
      gst: { quality: 'MISSING' },
      udyam: { quality: 'MISSING' },
      signatory: { quality: 'MISSING' },
      addressProof: {
        quality: 'OK',
        fields: { consumerNumber: '1', billedTo: 'Test Traders', supplyAddress: 'A', billDate: '' },
      },
      gstLookup: { status: 'NOT_RUN' },
      udyamLookup: { status: 'NOT_RUN' },
    };

    const ageOutcome = (billDate: string) => {
      process.env.TZ = zone;
      const today = createFixedClock({ today: '2026-07-15', now: '2026-07-15T18:45:00.000Z' }).today();
      const input: KycInput = {
        ...base,
        today,
        addressProof: {
          quality: 'OK',
          fields: { consumerNumber: '1', billedTo: 'Test Traders', supplyAddress: 'A', billDate },
        },
      };
      return assessKyc(input).checks.find((check) => check.id === 'ADDRESS_AGE')?.outcome;
    };

    it('passes a bill exactly 90 days old', () => {
      expect(ageOutcome('2026-04-16')).toBe('PASS');
    });

    it('fails a bill 91 days old', () => {
      expect(ageOutcome('2026-04-15')).toBe('FAIL');
    });
  });
});
