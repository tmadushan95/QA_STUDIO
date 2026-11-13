/** An error with an HTTP status and a stable code. The message is written for people and is safe to show. */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Per-field messages, so a form can show each next to its input. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}
