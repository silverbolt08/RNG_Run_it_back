import { describe, expect, it } from 'vitest';
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from '@/server/llm/provider';

/** A provider that can only be written if the interface carries a whole tool round trip. */
const scripted: LlmProvider = {
  complete: async (request: LlmRequest): Promise<LlmResponse> => {
    const last = request.messages.at(-1);
    if (last?.role === 'tool') return { text: `Result was ${last.content}`, toolCalls: [] };
    return { text: '', toolCalls: [{ id: 'call_1', name: 'recommend_bundle', input: { needs: [] } }] };
  },
};

describe('LlmProvider', () => {
  it('can send a tool result back to the model, so the advisor loop can finish a turn', async () => {
    const base = { system: 'Explain only.', tools: [], maxTokens: 100 };
    const messages: LlmMessage[] = [{ role: 'user', content: 'mere shop mein wifi chahiye' }];

    const first = await scripted.complete({ ...base, messages });
    const call = first.toolCalls[0];
    if (!call) throw new Error('Expected a tool call');

    const second = await scripted.complete({
      ...base,
      messages: [
        ...messages,
        { role: 'assistant', content: first.text, toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: call.id, name: call.name, content: '{"lines":[]}' },
      ],
    });
    expect(second.text).toBe('Result was {"lines":[]}');
  });
});
