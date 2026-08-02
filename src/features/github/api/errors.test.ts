import { classifyGitHubError } from './errors';

function headers(values: Record<string, string> = {}): Headers {
  return new Headers(values);
}

describe('classifyGitHubError', () => {
  it('maps 401 to reauth', () => {
    expect(classifyGitHubError(401, headers(), { message: 'Bad credentials' }).code).toBe(
      'reauth_required',
    );
  });

  describe('403 disambiguation', () => {
    it('detects the primary rate limit via x-ratelimit-remaining', () => {
      const error = classifyGitHubError(
        403,
        headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
        {},
      );
      expect(error.code).toBe('github_rate_limited');
      expect(error.retryAt).toBe(1700000000 * 1000);
      expect(error.retryable).toBe(false);
    });

    it('detects the secondary rate limit via retry-after', () => {
      const error = classifyGitHubError(403, headers({ 'retry-after': '60' }), {});
      expect(error.code).toBe('github_secondary_rate_limit');
      expect(error.retryAt).toBeDefined();
    });

    it('detects SSO and extracts the authorization url', () => {
      const error = classifyGitHubError(
        403,
        headers({ 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?return_to=x' }),
        {},
      );
      expect(error.code).toBe('github_sso_required');
      expect(error.ssoUrl).toBe('https://github.com/orgs/acme/sso?return_to=x');
    });

    it('falls back to plain forbidden', () => {
      const error = classifyGitHubError(403, headers(), { message: 'Resource not accessible' });
      expect(error.code).toBe('github_forbidden');
      expect(error.action).toBe('manage_access');
    });

    it('prefers SSO over rate limiting when both headers are present', () => {
      const error = classifyGitHubError(
        403,
        headers({ 'x-github-sso': 'required; url=https://example.com', 'x-ratelimit-remaining': '0' }),
        {},
      );
      expect(error.code).toBe('github_sso_required');
    });
  });

  it('maps 404 to not-found with a manage-access action', () => {
    const error = classifyGitHubError(404, headers(), { message: 'Not Found' });
    expect(error.code).toBe('github_not_found');
    expect(error.action).toBe('manage_access');
  });

  it('maps 409 with an empty-repo body to a friendly empty state', () => {
    const error = classifyGitHubError(409, headers(), { message: 'Git Repository is empty.' });
    expect(error.code).toBe('github_repo_empty');
  });

  it('does not treat every 409 as an empty repo', () => {
    expect(classifyGitHubError(409, headers(), { message: 'Conflict' }).code).toBe('unknown');
  });

  it('maps 429 with retry-after to the secondary limit', () => {
    expect(classifyGitHubError(429, headers({ 'retry-after': '30' }), {}).code).toBe(
      'github_secondary_rate_limit',
    );
  });

  it('treats 5xx as retryable', () => {
    const error = classifyGitHubError(502, headers(), {});
    expect(error.code).toBe('github_server_error');
    expect(error.retryable).toBe(true);
  });

  it('surfaces the API message for unclassified statuses', () => {
    const error = classifyGitHubError(422, headers(), { message: 'Validation failed' });
    expect(error.code).toBe('unknown');
    expect(error.message).toBe('Validation failed');
  });
});
