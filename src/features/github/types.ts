/** Wire types for the GitHub endpoints this app touches. */

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

/**
 * Device-flow poll errors. GitHub returns these with HTTP 200 and an `error`
 * field, so a successful HTTP status does not mean the poll succeeded.
 */
export type DeviceFlowErrorCode =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'unsupported_grant_type'
  | 'incorrect_client_credentials'
  | 'incorrect_device_code'
  | 'access_denied'
  | 'device_flow_disabled';

export type OAuthErrorResponse = {
  error: string;
  error_description?: string;
  error_uri?: string;
  /** Present on `slow_down`; seconds, and may exceed our current interval. */
  interval?: number;
};

/**
 * Token response.
 *
 * `expires_in`, `refresh_token` and `refresh_token_expires_in` are only present
 * when the GitHub App has user-to-server token expiration ENABLED. With it off,
 * the token never expires and those three fields are absent entirely — which is
 * why they are optional here and why expiry math must tolerate undefined.
 */
export type TokenResponse = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

export type OAuthResponse = TokenResponse | OAuthErrorResponse;

export function isOAuthError(value: OAuthResponse): value is OAuthErrorResponse {
  return typeof (value as OAuthErrorResponse).error === 'string';
}

// ---------------------------------------------------------------------------
// Stored credential
// ---------------------------------------------------------------------------

export type GitHubTokenRecord = {
  /** Bumped when the shape changes; mismatches are discarded, not migrated. */
  version: 1;
  /** Discarded if the app's GitHub App identity changed under us. */
  clientId: string;
  accessToken: string;
  /** Absent when the App has token expiration disabled. */
  refreshToken?: string;
  issuedAt: number;
  /** Absent for non-expiring grants — treat as "never proactively refresh". */
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
};

export type AuthStatus = 'unknown' | 'disconnected' | 'connected' | 'reauth_required';

export type GitHubConnection = {
  status: AuthStatus;
  login?: string;
  avatarUrl?: string;
  connectedAt?: number;
};

// ---------------------------------------------------------------------------
// REST resources
// ---------------------------------------------------------------------------

export type GitHubAccount = {
  id: number;
  login: string;
  avatar_url: string;
  type?: string;
};

export type GitHubUser = GitHubAccount & {
  name?: string | null;
};

export type RepositorySelection = 'all' | 'selected';

export type Installation = {
  id: number;
  account: GitHubAccount | null;
  repository_selection: RepositorySelection;
  html_url: string;
  app_slug?: string;
  permissions?: Record<string, string>;
};

export type UserInstallationsResponse = {
  total_count: number;
  installations: Installation[];
};

export type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  archived?: boolean;
  disabled?: boolean;
  default_branch: string;
  description?: string | null;
  html_url: string;
  owner: GitHubAccount;
  pushed_at?: string | null;
};

export type InstallationRepositoriesResponse = {
  total_count: number;
  repository_selection?: RepositorySelection;
  repositories: Repository[];
};

export type TreeEntry = {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
  url?: string;
};

export type TreeResponse = {
  sha: string;
  url: string;
  tree: TreeEntry[];
  /** True when the repo exceeded 100,000 entries / 7 MB. */
  truncated: boolean;
};

export type CommitResponse = {
  sha: string;
  commit: {
    tree: { sha: string; url: string };
    message: string;
    author?: { name?: string; date?: string };
  };
};
