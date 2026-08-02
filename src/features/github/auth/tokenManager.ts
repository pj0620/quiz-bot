import { requireGitHubConfig } from '../../../config/env';
import { AppError, ReauthRequiredError, toAppError } from '../../../lib/errors';
import { nowMs } from '../../../lib/time';
import { GITHUB } from '../config';
import type { AuthStatus, GitHubTokenRecord, TokenResponse } from '../types';
import { clearConnection, getConnection, setStatus } from './connectionStore';
import { refreshAccessToken } from './deviceFlow';
import { deleteTokenRecord, readTokenRecord, writeTokenRecord } from './secureTokenStore';

/*
 * SCOPE-NARROWING HOOK.
 * Today: one user-to-server token whose reach == the installation's repo
 * selection (installation_repos ∩ user_accessible_repos).
 * A narrower, per-repository token (POST /app/installations/{id}/access_tokens
 * with repository_ids) requires a JWT signed with the GitHub App private key,
 * which requires a backend. If that ever lands, this function grows a
 * `scope?: { installationId, repositoryIds }` argument and dispatches to a
 * strategy — every call site in the app already funnels through here.
 */

/** Clock skew beyond this makes us distrust the record's own timestamps. */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

let cache: GitHubTokenRecord | null | undefined; // undefined = not yet read from the keychain
let refreshInFlight: Promise<GitHubTokenRecord> | null = null;

function clientId(): string {
  return requireGitHubConfig().clientId;
}

/** Builds a record from a token response, tolerating absent expiry fields. */
export function recordFromTokenResponse(
  response: TokenResponse,
  issuedAt: number = nowMs(),
): GitHubTokenRecord {
  return {
    version: 1,
    clientId: clientId(),
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    issuedAt,
    accessTokenExpiresAt:
      response.expires_in != null ? issuedAt + response.expires_in * 1000 : undefined,
    refreshTokenExpiresAt:
      response.refresh_token_expires_in != null
        ? issuedAt + response.refresh_token_expires_in * 1000
        : undefined,
  };
}

/** Persists a brand-new grant from a completed device flow. */
export async function persistNewGrant(response: TokenResponse): Promise<GitHubTokenRecord> {
  const record = recordFromTokenResponse(response);

  if (__DEV__ && !record.refreshToken) {
    console.warn(
      '[quizbot] GitHub returned no refresh_token. This means "user-to-server token expiration" ' +
        'is DISABLED for your GitHub App, so the access token never expires and cannot be rotated. ' +
        'GitHub recommends enabling it: App settings -> Optional Features -> User-to-server token expiration.',
    );
  }

  await writeTokenRecord(record);
  cache = record;
  setStatus('connected');
  return record;
}

/**
 * Returns a usable access token, refreshing first if it is close to expiry.
 *
 * Decision order matters; see the inline notes. In particular step 4 is what
 * keeps non-expiring grants from refreshing on every single request.
 */
export async function getValidAccessToken(): Promise<string> {
  if (cache === undefined) {
    cache = await readTokenRecord(clientId());
  }
  const record = cache;
  if (!record) {
    throw new ReauthRequiredError('no_token');
  }

  const now = nowMs();

  // 2. Device clock moved backwards (or the record is bogus): its timestamps
  //    cannot be trusted, so refresh and let the 401 path be the backstop.
  if (record.issuedAt > now + CLOCK_SKEW_TOLERANCE_MS) {
    return (await refreshOnce()).accessToken;
  }

  // 3. The refresh token itself is dead — no point spending a round trip.
  if (record.refreshTokenExpiresAt != null && record.refreshTokenExpiresAt <= now) {
    await handleReauthRequired('refresh_token_expired');
    throw new ReauthRequiredError('refresh_token_expired');
  }

  // 4. Non-expiring grant (token expiration disabled on the GitHub App).
  //    Without this guard the arithmetic below would be NaN, compare false, and
  //    refresh on every request with an undefined refresh token — a hot loop.
  if (record.accessTokenExpiresAt == null) {
    return record.accessToken;
  }

  // 5. Still comfortably valid.
  if (record.accessTokenExpiresAt - now > GITHUB.refreshMarginMs) {
    return record.accessToken;
  }

  // 6. Expiring soon (or already expired).
  return (await refreshOnce()).accessToken;
}

/**
 * Forces a refresh regardless of expiry. Called by the 401 handler, which is the
 * only thing that catches server-side revocation and clock skew.
 */
export async function forceRefresh(): Promise<string> {
  // Drop the cache so doRefresh re-reads the keychain — a reconnect may have
  // landed since this request started.
  cache = undefined;
  return (await refreshOnce()).accessToken;
}

/**
 * Collapses concurrent refreshes onto one network call. Twenty requests that all
 * discover a stale token share a single doRefresh() promise instead of firing
 * twenty refreshes and racing to persist rotated tokens over each other.
 */
function refreshOnce(): Promise<GitHubTokenRecord> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<GitHubTokenRecord> {
  if (cache === undefined) {
    cache = await readTokenRecord(clientId());
  }
  const record = cache;

  if (!record?.refreshToken) {
    // Either nothing stored, or a non-expiring grant that GitHub has now
    // rejected. Neither is recoverable without the user re-authorizing.
    await handleReauthRequired(record ? 'refresh_rejected' : 'no_token');
    throw new ReauthRequiredError(record ? 'refresh_rejected' : 'no_token');
  }

  let outcome: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    outcome = await refreshAccessToken(record.refreshToken);
  } catch (error) {
    // Transport failure. Critically: do NOT clear tokens here — being offline
    // is not the same as being deauthorized.
    throw toAppError(error);
  }

  if (outcome.kind === 'error') {
    switch (outcome.code) {
      case 'bad_refresh_token':
      case 'unauthorized':
      case 'bad_verification_code':
        await handleReauthRequired('refresh_rejected');
        throw new ReauthRequiredError('refresh_rejected', { message: outcome.message });
      case 'incorrect_client_credentials':
        // Would mean GitHub started demanding a secret for device-flow refresh,
        // contradicting its docs. Never retry — that path loops forever.
        await handleReauthRequired('client_changed');
        throw new ReauthRequiredError('client_changed', { message: outcome.message });
      default:
        throw new AppError('unknown', { message: outcome.message });
    }
  }

  const next = recordFromTokenResponse(outcome.token);
  // GitHub reissues the refresh token on every refresh; keeping the old one
  // would strand us one rotation behind. Persist BEFORE updating the cache so a
  // failed write can never leave a rotated token living only in memory.
  await writeTokenRecord(next);
  cache = next;
  setStatus('connected');
  return next;
}

/**
 * The dead-grant path: 6-month refresh expiry, revocation, or a rejected refresh.
 *
 * Deletes the credential (a dead token is pure liability) but deliberately keeps
 * the login/avatar and every InfoSource row, so reconnecting restores the user's
 * repo picks rather than making them start over.
 */
async function handleReauthRequired(_reason: string): Promise<void> {
  await deleteTokenRecord().catch(() => undefined);
  cache = null;
  refreshInFlight = null;
  setStatus('reauth_required');
}

/** Synchronous status for UI, derived from the non-secret connection store. */
export function getAuthSnapshot(): AuthStatus {
  return getConnection().status;
}

export async function hasStoredToken(): Promise<boolean> {
  if (cache === undefined) {
    cache = await readTokenRecord(clientId());
  }
  return cache != null;
}

/** Reads the record for diagnostics screens. Never log this in production. */
export async function peekTokenRecord(): Promise<GitHubTokenRecord | null> {
  if (cache === undefined) {
    cache = await readTokenRecord(clientId());
  }
  return cache;
}

/**
 * Clears local credentials.
 *
 * This CANNOT revoke the grant on GitHub's side: DELETE /applications/{client_id}/token
 * requires HTTP Basic auth with the client secret, which a public client does not
 * have. Callers must tell the user to revoke at GITHUB.authorizationsUrl.
 */
export async function disconnectGitHub(): Promise<void> {
  await deleteTokenRecord().catch(() => undefined);
  cache = null;
  refreshInFlight = null;
  clearConnection();
}

/** Test seam: drops in-memory state so each test starts cold. */
export function __resetTokenManagerForTests(): void {
  cache = undefined;
  refreshInFlight = null;
}
