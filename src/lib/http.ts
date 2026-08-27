import { backgroundClock } from './appState';
import { AppError, isRetryableTransportError, toAppError } from './errors';
import { abortError, isAbortError, sleep } from './time';

/** React Native's fetch has no timeout of its own, so every request gets one. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Extra attempts after a connection is dropped rather than answered.
 *
 * Two, not more. The failure this recovers from is the app being suspended, and
 * the user has to come back for a retry to run at all — so a third attempt buys
 * very little and every attempt at an LLM endpoint may be billed, since a
 * dropped socket says nothing about whether the provider processed the request.
 * Paying twice occasionally is much better than losing the note, which costs
 * the whole thing again on the next run anyway.
 */
export const MAX_RETRIES = 2;

/**
 * Waited AFTER the app is back in the foreground, not instead of waiting.
 *
 * iOS restores the app before it restores the radio, so retrying on the first
 * frame after resuming reliably fails a second time on exactly the notes this
 * is here to save.
 */
const RETRY_BACKOFF_MS = [1_000, 4_000];

/**
 * Longest a single timer waits before re-checking.
 *
 * The deadline is re-derived on every tick rather than trusted once, because
 * `setTimeout` measures wall-clock and this timeout is meant to measure time the
 * app was actually awake. Re-checking is what lets a request survive being
 * backgrounded — see `appState.ts`.
 */
const MAX_TICK_MS = 30_000;

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
  /** Extra attempts after a dropped connection. Defaults to `MAX_RETRIES`. */
  retries?: number;
};

/**
 * Runs fetch with a timeout, retrying a connection that was cut off rather than
 * answered — and waiting for the app to be awake before it does.
 *
 * Between them these are what let a generation run survive the user leaving the
 * app, which fails in two separate ways without them:
 *
 *  - The timeout budget is FOREGROUND time, not wall-clock. Time the app spent
 *    suspended is given back, so returning to the app doesn't cash in the whole
 *    budget of every in-flight request at once.
 *  - iOS closes open sockets when it suspends an app, so patience alone isn't
 *    enough: the request is already dead and only a new one can finish it. That
 *    arrives as `connection_lost`, and it is retried from the top — with a
 *    fresh timeout budget, because the attempt that failed is not evidence
 *    about how long the next one will take.
 *
 * A caller-initiated abort is never retried: cancelling has to mean cancelled.
 */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { retries = MAX_RETRIES, signal, ...rest } = options;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attemptRequest(url, { ...rest, signal });
    } catch (error) {
      if (attempt >= retries || isAbortError(error) || !isRetryableTransportError(error)) {
        throw error;
      }
      // Both of these reject if the run is cancelled while we wait, so a
      // cancelled run doesn't leave a retry parked until the user returns.
      await backgroundClock.whenForeground(signal);
      await sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)], signal);
    }
  }
}

/** One attempt, with its own timeout budget and its own abort controller. */
async function attemptRequest(
  url: string,
  options: Omit<RequestOptions, 'retries'>,
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = options;
  const controller = new AbortController();

  if (signal?.aborted) throw abortError();
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  const startedAt = Date.now();
  const suspendedAtStart = backgroundClock.elapsed();

  /** Budget left, ignoring any stretch the app spent suspended. */
  const remaining = () => {
    const suspended = backgroundClock.elapsed() - suspendedAtStart;
    return timeoutMs - (Date.now() - startedAt - suspended);
  };

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;

  const tick = () => {
    const left = remaining();
    if (left <= 0) {
      timedOut = true;
      controller.abort();
      return;
    }
    // Floored so a request that is still suspended re-checks occasionally
    // instead of spinning on a near-zero remainder.
    timer = setTimeout(tick, Math.min(MAX_TICK_MS, Math.max(left, 1_000)));
  };
  timer = setTimeout(tick, Math.min(MAX_TICK_MS, timeoutMs));

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
