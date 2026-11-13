/**
 * The HTTP client every feature uses. One place turns server errors into `ApiError` (with per-field messages for
 * forms) and tells the app when sign-in is needed, so features only describe their requests.
 */

/** A failed request, with the server's message and, for forms, one message per field. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
    readonly status = 0,
    readonly code = '',
  ) {
    super(message);
  }
}

/** Fired when the server answers 401, so the app can show the access-token screen. */
export const AUTH_REQUIRED_EVENT = 'qa-auth-required';

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let fields: Record<string, string> = {};
    let code = '';
    try {
      const body = (await res.json()) as {
        error?: { message?: string; fields?: Record<string, string>; code?: string };
      };
      if (body.error?.message) message = body.error.message;
      if (body.error?.fields) fields = body.error.fields;
      if (body.error?.code) code = body.error.code;
    } catch {
      /* a body that is not JSON keeps the generic message */
    }
    if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    throw new ApiError(message, fields, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET a JSON resource. */
export async function get<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url));
}

/** Send JSON with a method (POST by default) and read the JSON answer. */
export async function send<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    }),
  );
}

/** Upload one file as multipart form data. */
export async function upload<T>(url: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  return parse<T>(await fetch(url, { method: 'POST', body }));
}

/** Encode a path segment such as a test case ID. */
export const seg = encodeURIComponent;

/** A readable message for anything thrown. */
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.';
