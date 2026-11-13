import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './types.js';

type Scripted = string | LlmError | ((req: LlmRequest) => string);

/**
 * A model for tests and demos: answers come from a script, in order, and every request is recorded.
 * Nothing leaves the process, so CI never calls a real model.
 */
export class FakeLlm implements LlmClient {
  readonly provider = 'fake' as const;
  readonly model: string;
  readonly requests: LlmRequest[] = [];
  private readonly script: Scripted[];

  constructor(script: Scripted[] = [], model = 'fake-1') {
    this.script = [...script];
    this.model = model;
  }

  push(...more: Scripted[]): this {
    this.script.push(...more);
    return this;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const next = this.script.shift();
    if (next === undefined) throw new Error('FakeLlm: no scripted answer left for this request.');
    if (next instanceof LlmError) throw next;
    const text = typeof next === 'function' ? next(req) : next;
    const input = req.messages.reduce((n, m) => n + m.content.length, req.system?.length ?? 0);
    return {
      text,
      provider: 'fake',
      model: this.model,
      usage: { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(text.length / 4) },
    };
  }
}
