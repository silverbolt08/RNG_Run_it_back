import type { Clock } from '../../lib/clock';
import { LlmUnavailableError, type LlmProvider } from './provider';

// A free tier fails in bursts, so one failure rests that model before the next owner has to wait.
const REST_AFTER_FAILURE_MS = 30_000;

/**
 * Tries each model in turn, skipping any that failed recently. If all are unavailable it rejects at
 * once, and the owner moves to tappable choices without a long wait.
 */
export function createResilientProvider(providers: readonly LlmProvider[], clock: Pick<Clock, 'now'>): LlmProvider {
  const restingUntil = new Map<LlmProvider, number>();

  return {
    label: providers.map((provider) => provider.label).join(' > '),
    async complete(request) {
      let lastError: unknown = new LlmUnavailableError('no provider');

      for (const provider of providers) {
        const now = clock.now().getTime();
        if ((restingUntil.get(provider) ?? 0) > now) continue;

        try {
          return await provider.complete(request);
        } catch (error) {
          lastError = error;
          restingUntil.set(provider, clock.now().getTime() + REST_AFTER_FAILURE_MS);
        }
      }
      throw lastError;
    },
  };
}
