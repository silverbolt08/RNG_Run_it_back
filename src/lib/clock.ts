// The data pack's README fixes "today" for every date-based check.
const DEFAULT_BUSINESS_DATE = '2026-07-15';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The app has two clocks. Business rules such as bill age and install dates use a fixed date,
 * while sessions, audit records and retention need real time. Keeping them apart stops a
 * July 2026 demo date from expiring every session.
 */
export type Clock = {
  /** The business date, as YYYY-MM-DD. A plain string, so no time zone can shift it. */
  today(): string;
  /** Real system time. */
  now(): Date;
};

export function createSystemClock(businessDate: string = DEFAULT_BUSINESS_DATE): Clock {
  assertBusinessDate(businessDate);
  return { today: () => businessDate, now: () => new Date() };
}

export function createClockFromEnv(env: Readonly<Record<string, string | undefined>>): Clock {
  return createSystemClock(env.APP_TODAY ?? DEFAULT_BUSINESS_DATE);
}

/** A clock that doesn't move, for tests. `advance` lets a retention test jump forward. */
export function createFixedClock(start: { today: string; now: string }): Clock & { advanceDays(days: number): void } {
  assertBusinessDate(start.today);
  let current = new Date(start.now).getTime();
  return {
    today: () => start.today,
    now: () => new Date(current),
    advanceDays: (days) => {
      current += days * 86_400_000;
    },
  };
}

function assertBusinessDate(value: string): void {
  const match = ISO_DATE.exec(value);
  const valid =
    match !== null &&
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10) === value;
  if (!valid) throw new Error(`APP_TODAY must be a real date as YYYY-MM-DD, got "${value}"`);
}
