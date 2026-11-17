import { postJson, type FetchLike } from './http.js';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './types.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  baseUrl?: string;
  defaultTimeoutMs?: number;
}

/** Anthropic Messages API. */
export class AnthropicClient implements LlmClient {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private readonly fetchFn: FetchLike;

  constructor(private readonly o: AnthropicOptions) {
    this.model = o.model;
    this.fetchFn = o.fetch ?? ((url, init) => fetch(url, init));
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = await postJson(
      this.fetchFn,
      `${this.o.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.o.model,
        max_tokens: req.maxTokens,
        ...(req.system && { system: req.system }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        // Plain text stays a string; files become image or document blocks ahead of the text, as the API expects.
        messages: req.messages.map((m) =>
          m.attachments?.length
            ? {
                role: m.role,
                content: [
                  ...m.attachments.map((a) => ({
                    type: a.mediaType === 'application/pdf' ? 'document' : 'image',
                    source: { type: 'base64', media_type: a.mediaType, data: a.data },
                  })),
                  { type: 'text', text: m.content },
                ],
              }
            : { role: m.role, content: m.content },
        ),
      },
      {
        key: this.o.apiKey,
        timeoutMs: req.timeoutMs ?? this.o.defaultTimeoutMs ?? 60_000,
        signal: req.signal,
      },
    );
    const r = body as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const text = (r?.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    if (!text) {
      throw new LlmError(
        r?.stop_reason === 'refusal' ? 'blocked' : 'empty',
        r?.stop_reason === 'refusal'
          ? 'The model declined to answer.'
          : 'The model returned no text.',
      );
    }
    return {
      text,
      provider: 'anthropic',
      model: this.o.model,
      usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 },
      ...(r.stop_reason && { stopReason: r.stop_reason }),
    };
  }
}
