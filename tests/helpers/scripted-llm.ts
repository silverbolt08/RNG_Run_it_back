import { LlmUnavailableError, type LlmProvider, type LlmRequest, type LlmResponse } from '@/server/llm/provider';

type TurnScript = Record<string, unknown>;

/** A stand-in LLM. It reads what it is told to, and writes what it is told to, so tests are exact. */
export class ScriptedLlm implements LlmProvider {
  readonly label = 'scripted';
  requests: LlmRequest[] = [];
  down = false;
  private readings: TurnScript[] = [];
  private writings: string[] = [];

  willRead(...readings: TurnScript[]): void {
    this.readings.push(...readings);
  }

  willWrite(...writings: string[]): void {
    this.writings.push(...writings);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    if (this.down) throw new LlmUnavailableError('status 503');
    if (request.forceTool) {
      return { text: '', toolCalls: [{ id: 'call-1', name: request.forceTool, input: this.readings.shift() ?? {} }] };
    }
    return { text: this.writings.shift() ?? 'Thank you. Let me look at that.', toolCalls: [] };
  }

  /** Everything the model was sent, for checking what it must never see. */
  allSent(): string {
    return JSON.stringify(this.requests);
  }
}
