/**
 * The interface only, and neutral about which provider sits behind it. The ai-engineer builds the
 * adapters in Phase 4, each reading its settings from LLM_PROVIDER, LLM_MODEL and LLM_API_KEY.
 *
 * Code decides eligibility, prices and verdicts, so nothing here returns a decision: only text
 * and requests to call a tool that runs those rules.
 */
export type LlmToolCall = {
  /** Links a result to its call. An adapter whose provider has no call IDs must generate one. */
  id: string;
  name: string;
  input: unknown;
};

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: readonly LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

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
  maxTokens: number;
};

export type LlmResponse = { text: string; toolCalls: readonly LlmToolCall[] };

export interface LlmProvider {
  /** Rejects if the provider is down or times out, so the caller can move to the guided path. */
  complete(request: LlmRequest): Promise<LlmResponse>;
}
