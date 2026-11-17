import { postJson, type FetchLike } from './http.js';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './types.js';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  baseUrl?: string;
  defaultTimeoutMs?: number;
}

/** Google Gemini `generateContent`. The key goes in a header, never in the URL, so it cannot end up in logs. */
export class GeminiClient implements LlmClient {
  readonly provider = 'gemini' as const;
  readonly model: string;
  private readonly fetchFn: FetchLike;

  constructor(private readonly o: GeminiOptions) {
    this.model = o.model;
    this.fetchFn = o.fetch ?? ((url, init) => fetch(url, init));
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const base = this.o.baseUrl ?? 'https://generativelanguage.googleapis.com';
    const body = await postJson(
      this.fetchFn,
      `${base}/v1beta/models/${encodeURIComponent(this.o.model)}:generateContent`,
      { 'x-goog-api-key': this.o.apiKey },
      {
        ...(req.system && { systemInstruction: { parts: [{ text: req.system }] } }),
        contents: req.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          // Files go in as inline data ahead of the text.
          parts: [
            ...(m.attachments ?? []).map((a) => ({
              inline_data: { mime_type: a.mediaType, data: a.data },
            })),
            { text: m.content },
          ],
        })),
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          ...(req.temperature !== undefined && { temperature: req.temperature }),
        },
      },
      {
        key: this.o.apiKey,
        timeoutMs: req.timeoutMs ?? this.o.defaultTimeoutMs ?? 60_000,
        signal: req.signal,
      },
    );
    const r = body as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      promptFeedback?: { blockReason?: string };
    };
    if (r?.promptFeedback?.blockReason) {
      throw new LlmError(
        'blocked',
        `Gemini declined the request (${r.promptFeedback.blockReason}).`,
      );
    }
    const cand = r?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text) {
      throw new LlmError(
        cand?.finishReason === 'SAFETY' ? 'blocked' : 'empty',
        cand?.finishReason === 'SAFETY'
          ? 'Gemini declined to answer.'
          : 'The model returned no text.',
      );
    }
    return {
      text,
      provider: 'gemini',
      model: this.o.model,
      usage: {
        inputTokens: r.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0,
      },
      ...(cand?.finishReason && { stopReason: cand.finishReason }),
    };
  }
}
