import { describe, expect, it } from 'vitest';
import { createGeminiProvider } from '@/server/llm/gemini-provider';
import { LlmUnavailableError, type LlmProvider, type LlmRequest } from '@/server/llm/provider';
import { createResilientProvider } from '@/server/llm/resilient-provider';

const REQUEST: LlmRequest = { system: 'Be brief.', messages: [{ role: 'user', content: 'Hello' }], tools: [], maxTokens: 100 };

function gemini(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createGeminiProvider({
    apiKey: 'test-key-not-a-secret',
    model: 'test-model',
    timeoutMs: 1000,
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
  });
  return { provider, calls };
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('the Gemini adapter', () => {
  it('sends the key in a header, never in the URL', async () => {
    const { provider, calls } = gemini(() => reply({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }));
    await provider.complete(REQUEST);
    expect(calls[0]?.url).not.toContain('test-key-not-a-secret');
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key-not-a-secret');
  });

  it('returns text, leaving out the model\'s private thoughts', async () => {
    const { provider } = gemini(() =>
      reply({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Hello there' }] } }] }),
    );
    await expect(provider.complete(REQUEST)).resolves.toMatchObject({ text: 'Hello there', toolCalls: [] });
  });

  it('returns tool calls, and forces the tool that was asked for', async () => {
    const { provider, calls } = gemini(() =>
      reply({ candidates: [{ content: { parts: [{ functionCall: { name: 'record_turn', args: { numSites: 2 } } }] } }] }),
    );
    const tool = { name: 'record_turn', description: 'd', inputSchema: { type: 'object' } };
    const response = await provider.complete({ ...REQUEST, tools: [tool], forceTool: 'record_turn' });

    expect(response.toolCalls[0]).toMatchObject({ name: 'record_turn', input: { numSites: 2 } });
    const sent = JSON.parse(String(calls[0]?.init.body));
    expect(sent.toolConfig.functionCallingConfig).toEqual({ mode: 'ANY', allowedFunctionNames: ['record_turn'] });
    expect(sent.tools[0].functionDeclarations[0].name).toBe('record_turn');
  });

  it.each([
    ['a busy provider', () => reply({ error: { message: 'secret echo' } }, 429), 'status 429'],
    ['an outage', () => reply({}, 503), 'status 503'],
    ['a blocked prompt', () => reply({ promptFeedback: { blockReason: 'SAFETY' } }), 'blocked: SAFETY'],
    ['an empty answer', () => reply({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), 'empty: MAX_TOKENS'],
    ['a garbled body', () => new Response('<html>'), 'unreadable response'],
  ])('reports %s as unavailable, echoing nothing it was sent', async (_, respond, reason) => {
    const { provider } = gemini(respond);
    const error = await provider.complete(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as LlmUnavailableError).reason).toBe(reason);
  });

  it('reports a network failure as unavailable', async () => {
    const { provider } = gemini(() => {
      throw new TypeError('fetch failed');
    });
    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

describe('the resilient provider', () => {
  const clock = { nowMs: 0, now() { return new Date(this.nowMs); } };
  const fake = (label: string, behaviour: () => string): LlmProvider & { calls: number } => ({
    label,
    calls: 0,
    async complete() {
      this.calls += 1;
      return { text: behaviour(), toolCalls: [] };
    },
  });
  const down = (): string => {
    throw new LlmUnavailableError('status 503');
  };

  it('moves to the next model when the first fails', async () => {
    const first = fake('a', down);
    const second = fake('b', () => 'from b');
    const resilient = createResilientProvider([first, second], clock);
    await expect(resilient.complete(REQUEST)).resolves.toMatchObject({ text: 'from b' });
  });

  it('rests a failing model, then tries it again later', async () => {
    clock.nowMs = 0;
    let isDown = true;
    const first = fake('a', () => (isDown ? down() : 'from a'));
    const second = fake('b', () => 'from b');
    const resilient = createResilientProvider([first, second], clock);

    await resilient.complete(REQUEST);
    await resilient.complete(REQUEST);
    expect(first.calls).toBe(1);

    isDown = false;
    clock.nowMs = 31_000;
    await expect(resilient.complete(REQUEST)).resolves.toMatchObject({ text: 'from a' });
  });

  it('rejects at once when every model is resting, so nobody waits', async () => {
    clock.nowMs = 0;
    const only = fake('a', down);
    const resilient = createResilientProvider([only], clock);
    await expect(resilient.complete(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(resilient.complete(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(only.calls).toBe(1);
  });
});
