import type { Clock } from '../../lib/clock';

export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimiter = {
  /** Counts one request. Returns the seconds to wait if the limit is hit, otherwise null. */
  hit(key: string, rule: RateLimitRule): number | null;
  size(): number;
};

// Past this many keys, expired ones are cleared, so a public route can't grow the map forever.
const PRUNE_ABOVE_KEYS = 10_000;

// In memory, which is enough for one deployable app. It resets on restart, and doesn't share
// across servers, so production would need a shared store.
export function createRateLimiter(clock: Clock): RateLimiter {
  const windows = new Map<string, { count: number; resetsAt: number }>();

  return {
    hit: (key, rule) => {
      const now = clock.now().getTime();
      const current = windows.get(key);

      if (!current || current.resetsAt <= now) {
        if (windows.size >= PRUNE_ABOVE_KEYS) pruneExpired(windows, now);
        windows.set(key, { count: 1, resetsAt: now + rule.windowSeconds * 1000 });
        return null;
      }
      if (current.count >= rule.limit) return Math.ceil((current.resetsAt - now) / 1000);

      current.count += 1;
      return null;
    },
    size: () => windows.size,
  };
}

function pruneExpired(windows: Map<string, { resetsAt: number }>, now: number): void {
  for (const [key, window] of windows) {
    if (window.resetsAt <= now) windows.delete(key);
  }
}

export const RATE_LIMITS = {
  otpRequest: { limit: 5, windowSeconds: 600 },
  otpVerify: { limit: 20, windowSeconds: 600 },
  newSession: { limit: 60, windowSeconds: 60 },
  upload: { limit: 30, windowSeconds: 600 },
  // Starting an application or confirming a GSTIN can return a name, so it must not become a way
  // to enumerate businesses.
  gstinLookup: { limit: 15, windowSeconds: 600 },
  registryRoute: { limit: 120, windowSeconds: 60 },
  // A guided-path owner toggling add-ons makes many of these, but not this many.
  quoteChange: { limit: 120, windowSeconds: 60 },
  recommendation: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
