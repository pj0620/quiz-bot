export const GITHUB = {
  /** OAuth/device-flow endpoints live on github.com, not the API host. */
  webHost: 'https://github.com',
  apiHost: 'https://api.github.com',

  deviceCodeUrl: 'https://github.com/login/device/code',
  accessTokenUrl: 'https://github.com/login/oauth/access_token',
  /** Where the user types the 8-character code. */
  verificationUrl: 'https://github.com/login/device',
  /** Users must revoke here — we cannot revoke without a client secret. */
  authorizationsUrl: 'https://github.com/settings/apps/authorizations',

  apiVersion: '2022-11-28',
  acceptJson: 'application/vnd.github+json',
  /** Avoids base64 entirely, and is mandatory for files over 1 MB. */
  acceptRaw: 'application/vnd.github.raw+json',

  deviceGrantType: 'urn:ietf:params:oauth:grant-type:device_code',
  refreshGrantType: 'refresh_token',

  /** GitHub's documented floor; never poll faster than this. */
  minPollIntervalMs: 5_000,
  /** Added on every `slow_down` response, per the spec. */
  slowDownIncrementMs: 5_000,
  /** Refresh this long before expiry so users rarely wait on a token round trip. */
  refreshMarginMs: 5 * 60_000,

  perPage: 100,
  /** Defensive cap on pagination loops. */
  maxPages: 10,

  /** GitHub caps recursive trees here; beyond it the response is truncated. */
  maxTreeEntries: 100_000,
} as const;

export function installUrl(appSlug: string): string {
  return `${GITHUB.webHost}/apps/${appSlug}/installations/new`;
}

/** Deep link to an existing installation's settings, for narrowing repo access. */
export function manageInstallationUrl(appSlug: string, htmlUrl?: string): string {
  return htmlUrl ?? installUrl(appSlug);
}
