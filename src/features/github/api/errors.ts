import { AppError, type AppErrorCode } from '../../../lib/errors';
import { HttpError } from '../../../lib/http';

/**
 * Single mapping point from a GitHub HTTP response to an AppError.
 *
 * Header-driven, because GitHub overloads 403 for at least three unrelated
 * conditions (primary rate limit, secondary rate limit, SSO) that need
 * completely different UI.
 */
export function classifyGitHubError(
  status: number,
  headers: Headers,
  body: unknown,
): AppError {
  const message = extractMessage(body);

  if (status === 401) {
    // Callers refresh and retry once before surfacing this.
    return new AppError('reauth_required', { cause: body });
  }

  if (status === 403 || status === 429) {
    const remaining = headers.get('x-ratelimit-remaining');
    const retryAfter = headers.get('retry-after');
    const sso = headers.get('x-github-sso');

    if (sso) {
      return new AppError('github_sso_required', {
        message:
          'This organization requires SAML SSO authorization before QuizBot can read its repositories.',
        ssoUrl: parseSsoUrl(sso),
      });
    }

    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      return new AppError('github_secondary_rate_limit', {
        retryAt: Number.isFinite(seconds) ? Date.now() + seconds * 1000 : undefined,
      });
    }

    if (remaining === '0') {
      const reset = Number.parseInt(headers.get('x-ratelimit-reset') ?? '', 10);
      const retryAt = Number.isFinite(reset) ? reset * 1000 : undefined;
      return new AppError('github_rate_limited', {
        message: retryAt
          ? `GitHub's rate limit is exhausted. It resets at ${new Date(retryAt).toLocaleTimeString()}.`
          : undefined,
        retryAt,
      });
    }

    return new AppError('github_forbidden', { message: message || undefined });
  }

  if (status === 404) {
    // GitHub returns 404 rather than 403 for repos you cannot see, to avoid
    // leaking their existence. So this means: deleted, renamed, never granted,
    // or the installation was removed.
    return new AppError('github_not_found');
  }

  if (status === 409) {
    // The tree endpoint uses 409 for a repo with no commits yet.
    if (/empty/i.test(message)) return new AppError('github_repo_empty');
    return new AppError('unknown', { message: message || undefined });
  }

  if (status >= 500) {
    return new AppError('github_server_error', { retryable: true });
  }

  return new AppError('unknown', { message: message || undefined });
}

/** Converts a thrown value from the http layer into an AppError. */
export function classifyThrown(error: unknown): AppError {
  if (error instanceof HttpError) {
    return classifyGitHubError(error.status, error.headers, error.bodyJson ?? error.bodyText);
  }
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.message?.includes('Network request failed')) {
    return new AppError('offline', { cause: error });
  }
  return new AppError('unknown', { cause: error });
}

function extractMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const value = (body as { message?: unknown }).message;
    if (typeof value === 'string') return value;
  }
  return '';
}

/** `x-github-sso: required; url=https://github.com/orgs/acme/sso?...` */
function parseSsoUrl(header: string): string | undefined {
  const match = /url=([^;,\s]+)/.exec(header);
  return match?.[1];
}

export type { AppErrorCode };
