import { randomUUID } from 'node:crypto';
import { LlmUnavailableError, type LlmProvider, type LlmRequest, type LlmResponse } from './provider';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Replaceable so tests never reach the network. */
  fetchImpl?: typeof fetch;
};

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown } };
type GeminiBody = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
};

/**
 * Gemini over plain REST, because one fetch call doesn't justify an SDK dependency. The key goes
 * in a header, so it can't end up in a URL or a log. Nothing from the request or response is logged.
 */
export function createGeminiProvider(options: GeminiOptions): LlmProvider {
  const send = options.fetchImpl ?? fetch;

  return {
    label: options.model,
    async complete(request) {
      let response: Response;
      try {
        response = await send(`${BASE_URL}/models/${encodeURIComponent(options.model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify(toGeminiRequest(request)),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new LlmUnavailableError(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
      }

      // Status only: an error body can echo what was sent.
      if (!response.ok) throw new LlmUnavailableError(`status ${response.status}`);

      const body = (await response.json().catch(() => null)) as GeminiBody | null;
      if (!body) throw new LlmUnavailableError('unreadable response');
      return fromGeminiBody(body);
    },
  };
}

function toGeminiRequest(request: LlmRequest): Record<string, unknown> {
  const contents = request.messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: request.maxTokens },
    ...(request.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              })),
            },
          ],
        }
      : {}),
    ...(request.forceTool
      ? { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [request.forceTool] } } }
      : {}),
  };
}

function fromGeminiBody(body: GeminiBody): LlmResponse {
  const candidate = body.candidates?.[0];
  if (!candidate) throw new LlmUnavailableError(`blocked: ${body.promptFeedback?.blockReason ?? 'no candidate'}`);

  const parts = candidate.content?.parts ?? [];
  const text = parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join('');
  const toolCalls = parts.flatMap((part) =>
    part.functionCall?.name ? [{ id: randomUUID(), name: part.functionCall.name, input: part.functionCall.args ?? {} }] : [],
  );

  if (text === '' && toolCalls.length === 0) {
    throw new LlmUnavailableError(`empty: ${candidate.finishReason ?? 'unknown'}`);
  }
  return { text, toolCalls };
}
