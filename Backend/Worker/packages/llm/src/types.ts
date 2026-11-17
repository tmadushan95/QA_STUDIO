export const PROVIDERS = ['anthropic', 'gemini'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The file types a model reads natively, beside the text: screenshots and PDF documents. */
export const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** A file sent with a message, read by the model as an image or a document. */
export interface LlmAttachment {
  mediaType: AttachmentType;
  /** The file's bytes, base64-encoded (no `data:` prefix). */
  data: string;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Files shown to the model before the text; only user messages carry them. */
  attachments?: LlmAttachment[];
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** 0 to 1. Generation of test steps wants low values. */
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  text: string;
  provider: Provider | 'fake';
  model: string;
  usage: LlmUsage;
  /** Why the model stopped, as the provider reports it (for example "max_tokens"). */
  stopReason?: string;
}

/** One model behind one provider. Adapters hold no state beyond their settings, so they are cheap to recreate. */
export interface LlmClient {
  readonly provider: Provider | 'fake';
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorKind =
  | 'auth' //         key missing, wrong or not allowed
  | 'rate-limit' //   too many requests or quota used up
  | 'bad-request' //  the provider rejected the request itself
  | 'server' //       the provider had a problem
  | 'network' //      could not reach the provider
  | 'timeout'
  | 'blocked' //      the provider refused to answer (safety filter)
  | 'empty' //        an answer with no text
  | 'budget' //       our own limits (calls or size) stopped it before sending
  | 'invalid-output'; // the answer was not the JSON that was asked for

export class LlmError extends Error {
  override name = 'LlmError';
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }

  /** Worth trying again a little later. */
  get retryable(): boolean {
    return this.kind === 'rate-limit' || this.kind === 'server' || this.kind === 'network';
  }
}
