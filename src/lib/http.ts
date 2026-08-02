import { AppError, toAppError } from './errors';
import { abortError, isAbortError } from './time';

/** React Native's fetch has no timeout of its own, so every request gets one. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** A non-2xx response. Carries enough for callers to classify it precisely. */
export class HttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;
  readonly bodyJson: unknown;

  constructor(status: number, headers: Headers, bodyText: string, bodyJson: unknown) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
    this.bodyText = bodyText;
    this.bodyJson = bodyJson;
  }
}

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Runs fetch with a timeout, chaining any caller-supplied signal so screen
 * unmounts and timeouts both abort the same request.
 */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = options;
  const controller = new AbortController();

  if (signal?.aborted) throw abortError();
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (error) {
    // Distinguish our own timeout from a caller-initiated cancellation: the
    // former is a user-visible error, the latter should be swallowed silently.
    if (timedOut) throw new AppError('timeout', { cause: error });
    if (isAbortError(error)) throw error;
    throw toAppError(error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Parses a body as JSON, tolerating empty and non-JSON responses. */
async function readBody(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  if (!text) return { text, json: undefined };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: undefined };
  }
}

/**
 * Requests JSON and throws `HttpError` on non-2xx.
 *
 * Note: GitHub's OAuth endpoints return HTTP 200 with an `error` field on
 * failure, so a 2xx here does NOT imply success for those — callers must
 * inspect the payload. See features/github/auth/deviceFlow.ts.
 */
export async function requestJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  const response = await request(url, options);
  const { text, json } = await readBody(response);

  if (!response.ok) {
    throw new HttpError(response.status, response.headers, text, json);
  }
  return { data: json as T, headers: response.headers, status: response.status };
}

/** Requests a plain-text body (used for raw file contents). */
export async function requestText(
  url: string,
  options: RequestOptions = {},
): Promise<{ data: string; headers: Headers; status: number }> {
  const response = await request(url, options);
  const { text, json } = await readBody(response);

  if (!response.ok) {
    throw new HttpError(response.status, response.headers, text, json);
  }
  return { data: text, headers: response.headers, status: response.status };
}

/**
 * Parses an RFC 5988 `Link` header into { rel: url }.
 * GitHub paginates with `<https://...&page=2>; rel="next", <...>; rel="last"`.
 */
export function parseLinkHeader(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const links: Record<string, string> = {};
  for (const section of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?([^";]+)"?/.exec(section.trim());
    if (match) links[match[2].trim()] = match[1].trim();
  }
  return links;
}
