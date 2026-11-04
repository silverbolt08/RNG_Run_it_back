import type { Clock } from '../../lib/clock';
import type { LlmConfig } from '../config';
import { createGeminiProvider } from './gemini-provider';
import type { LlmProvider } from './provider';
import { createResilientProvider } from './resilient-provider';

/** Returns null when no LLM is configured, which is a supported way to run: the guided path works. */
export function createLlmProvider(config: LlmConfig, clock: Pick<Clock, 'now'>): LlmProvider | null {
  if (config.provider !== 'gemini' || !config.apiKey) return null;
  const { apiKey, timeoutMs } = config;
  return createResilientProvider(
    config.models.map((model) => createGeminiProvider({ apiKey, model, timeoutMs })),
    clock,
  );
}
