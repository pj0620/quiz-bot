/**
 * One error type for the whole app. Every failure path produces an AppError so
 * screens can render a message + an action without knowing where it came from.
 */

export type AppErrorCode =
  | 'offline'
  | 'connection_lost'
  | 'timeout'
  | 'config_missing'
  | 'reauth_required'
  | 'github_rate_limited'
  | 'github_secondary_rate_limit'
  | 'github_sso_required'
  | 'github_forbidden'
  | 'github_not_found'
  | 'github_repo_empty'
  | 'github_server_error'
  | 'llm_not_configured'
  | 'llm_unauthorized'
  | 'llm_rate_limited'
  | 'llm_quota_exceeded'
  | 'llm_server_error'
  | 'llm_bad_response'
  | 'storage'
  | 'unknown';

/** What the UI should offer the user in response. */
export type AppErrorAction = 'retry' | 'reconnect' | 'manage_access' | 'none';

export type AppErrorOptions = {
  message?: string;
  retryable?: boolean;
  action?: AppErrorAction;
  /** Absolute epoch ms when a retry is expected to succeed (rate limits). */
  retryAt?: number;
  /** For SSO: the org authorization URL parsed from the x-github-sso header. */
  ssoUrl?: string;
  cause?: unknown;
};

const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  offline: "You're offline. Check your connection and try again.",
  connection_lost: 'The connection dropped before a reply came back. Try again.',
  timeout: 'That request took too long. Try again.',
  config_missing: 'GitHub is not configured in this build.',
  reauth_required: 'Your GitHub connection expired. Reconnect to continue.',
  github_rate_limited: "You've hit GitHub's rate limit. Try again later.",
  github_secondary_rate_limit: 'GitHub is asking us to slow down. Try again shortly.',
  github_sso_required: 'This organization requires SSO authorization.',
  github_forbidden: "QuizBot doesn't have permission to read this. Check its repository access.",
  github_not_found: "That repository isn't available. It may have been renamed, deleted, or removed from QuizBot's access.",
  github_repo_empty: 'This repository is empty — there are no files to read yet.',
  github_server_error: 'GitHub is having trouble right now. Try again shortly.',
  llm_not_configured: 'Add an API key in Settings before generating questions.',
  llm_unauthorized: 'That API key was rejected. Check it in Settings.',
  llm_rate_limited: "You've hit the provider's rate limit. Try again shortly.",
  llm_quota_exceeded: 'Your account is out of credit with this provider.',
  llm_server_error: 'The provider is having trouble right now. Try again shortly.',
  llm_bad_response: "The model's reply couldn't be read as questions.",
  storage: "Couldn't save to this device.",
  unknown: 'Something went wrong.',
};

/** Codes where the user's own retry is plausibly useful. */
const RETRYABLE: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'offline',
  'connection_lost',
  'timeout',
  'github_secondary_rate_limit',
  'github_server_error',
  'llm_rate_limited',
  'llm_server_error',
  // Models are non-deterministic, so a reply that couldn't be parsed genuinely
  // may parse on a second attempt. Quota and auth failures will not.
  'llm_bad_response',
  'unknown',
]);

const DEFAULT_ACTIONS: Partial<Record<AppErrorCode, AppErrorAction>> = {
  reauth_required: 'reconnect',
  github_forbidden: 'manage_access',
  github_not_found: 'manage_access',
  github_sso_required: 'manage_access',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly action: AppErrorAction;
  readonly retryAt?: number;
  readonly ssoUrl?: string;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.action = options.action ?? DEFAULT_ACTIONS[code] ?? (RETRYABLE.has(code) ? 'retry' : 'none');
    this.retryAt = options.retryAt;
    this.ssoUrl = options.ssoUrl;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Thrown when the stored grant can no longer be used and the user must run the
 * device flow again. Carries a reason purely for diagnostics/logging.
 */
export type ReauthReason =
  | 'no_token'
  | 'refresh_token_expired'
  | 'refresh_rejected'
  | 'client_changed'
  | 'corrupt_record';

export class ReauthRequiredError extends AppError {
  readonly reason: ReauthReason;

  constructor(reason: ReauthReason, options: AppErrorOptions = {}) {
    super('reauth_required', options);
    this.name = 'ReauthRequiredError';
    this.reason = reason;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function isReauthRequired(value: unknown): value is ReauthRequiredError {
  return value instanceof ReauthRequiredError;
}

/**
 * Transport failures that mean the request never reached a conclusion.
 *
 * On Expo SDK 57 `fetch` is the native URLSession implementation, so these
 * arrive as the Foundation error text wrapped by ExpoModulesCore rather than as
 * React Native's single "Network request failed" — matched on the message
 * because no error code survives the bridge.
 *
 * The first entry is the one that matters most: iOS drops open sockets when it
 * suspends an app, so EVERY request in flight when the user leaves rejects with
 * `NSURLErrorNetworkConnectionLost`. It says nothing about the network and
 * nothing about the note; it means "ask again", which is what `lib/http.ts`
 * does once the app is awake.
 */
const CONNECTION_LOST = [
  'network connection was lost', // NSURLErrorNetworkConnectionLost (-1005)
  'software caused connection abort',
  'connection reset by peer',
  'cannot connect to host', // NSURLErrorCannotConnectToHost (-1004)
  'connection failure',
];

/** Genuinely no route to the internet — worth telling the user about. */
const OFFLINE = [
  'network request failed', // React Native's XHR fetch, when EXPO_PUBLIC_USE_RN_FETCH is set
  'connection appears to be offline', // NSURLErrorNotConnectedToInternet (-1009)
  'network is unreachable',
];

function matches(message: string, patterns: readonly string[]): boolean {
  const lower = message.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

/**
 * True when retrying is the right response rather than reporting a failure.
 *
 * Deliberately does NOT include our own `timeout`. A request that ran out of
 * budget was answered by nobody for minutes; sending it again just spends the
 * same money to wait the same minutes. A dropped socket is the opposite — the
 * request was cut off, not refused.
 */
export function isRetryableTransportError(value: unknown): boolean {
  const code = toAppError(value).code;
  return code === 'connection_lost' || code === 'offline';
}

/** Coerce anything thrown into an AppError so callers never handle raw unknowns. */
export function toAppError(value: unknown): AppError {
  if (value instanceof AppError) return value;
  if (value instanceof Error) {
    if (value.name === 'AbortError') return new AppError('timeout', { cause: value });
    const message = value.message ?? '';
    if (matches(message, CONNECTION_LOST)) return new AppError('connection_lost', { cause: value });
    if (matches(message, OFFLINE)) return new AppError('offline', { cause: value });
    // NSURLErrorTimedOut, which URLSession raises on its own idle interval
    // rather than on ours. Same meaning to the user, same message.
    if (matches(message, ['request timed out'])) return new AppError('timeout', { cause: value });
    return new AppError('unknown', { message, cause: value });
  }
  return new AppError('unknown', { cause: value });
}

/** Message safe to render to the user. */
export function userMessage(value: unknown): string {
  return toAppError(value).message;
}
