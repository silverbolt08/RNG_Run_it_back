/**
 * The interface only, and neutral about which provider sits behind it. Code decides eligibility,
 * prices and verdicts, so nothing here returns a decision: only text, and structured facts read
 * from what the owner said.
 */
export type LlmToolCall = {
  /** Links a result to its call. An adapter whose provider has no call IDs must generate one. */
  id: string;
  name: string;
  input: unknown;
};

export type LlmMessage = { role: 'user' | 'assistant'; content: string };

export type LlmTool = {
  name: string;
  description: string;
  /** Plain JSON Schema, which each adapter converts to its provider's form if needed. */
  inputSchema: Record<string, unknown>;
};

export type LlmRequest = {
  system: string;
  messages: readonly LlmMessage[];
  tools: readonly LlmTool[];
  /** Makes the model answer through this tool, rather than in prose. */
  forceTool?: string;
  maxTokens: number;
};

export type LlmResponse = { text: string; toolCalls: readonly LlmToolCall[] };

/** Rejected when the provider is down, busy or too slow, so the caller can move to the guided path. */
export class LlmUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`LLM unavailable: ${reason}`);
    this.name = 'LlmUnavailableError';
  }
}

export interface LlmProvider {
  /** Which model answered, for evaluation records. Holds no secret. */
  readonly label: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
