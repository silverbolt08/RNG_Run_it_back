import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@/lib/clock';
import { createRateLimiter } from '@/server/http/rate-limiter';

const RULE = { limit: 2, windowSeconds: 60 };

function setup() {
  const clock = createFixedClock({ today: '2026-07-15', now: '2026-11-04T10:00:00.000Z' });
  return { clock, limiter: createRateLimiter(clock) };
}

describe('rate limiter', () => {
  it('allows requests up to the limit, then says how long to wait', () => {
    const { limiter } = setup();
    expect(limiter.hit('a', RULE)).toBeNull();
    expect(limiter.hit('a', RULE)).toBeNull();
    expect(limiter.hit('a', RULE)).toBe(60);
  });

  it('counts each key separately', () => {
    const { limiter } = setup();
    limiter.hit('a', RULE);
    limiter.hit('a', RULE);
    expect(limiter.hit('b', RULE)).toBeNull();
  });

  it('starts again after the window', () => {
    const { clock, limiter } = setup();
    limiter.hit('a', RULE);
    limiter.hit('a', RULE);
    clock.advanceDays(1);
    expect(limiter.hit('a', RULE)).toBeNull();
  });

  it('forgets expired keys, so a public route cannot grow it forever', () => {
    const { clock, limiter } = setup();
    for (let index = 0; index < 20_000; index++) limiter.hit(`key-${index}`, RULE);
    clock.advanceDays(1);
    limiter.hit('trigger', RULE);
    expect(limiter.size()).toBeLessThan(10);
  });
});
