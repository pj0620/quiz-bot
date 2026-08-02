import Constants from 'expo-constants';

/**
 * GitHub App identity, read from app.json -> expo.extra.github.
 *
 * Neither value is a secret. The client ID is expected to ship in the bundle for
 * a public OAuth client, and the device flow never uses a client secret — so
 * there is nothing here that needs to be hidden or moved to a server.
 */
export type GitHubConfig = {
  clientId: string;
  appSlug: string;
};

type ExtraShape = {
  github?: Partial<GitHubConfig>;
};

function readExtra(): ExtraShape {
  // expoConfig is the modern field; manifest2/manifest cover older runtimes.
  const extra = Constants.expoConfig?.extra ?? (Constants as { manifest?: { extra?: unknown } }).manifest?.extra;
  return (extra ?? {}) as ExtraShape;
}

let cached: GitHubConfig | null = null;

/** Returns config, or null when it hasn't been filled in yet. */
export function getGitHubConfig(): GitHubConfig | null {
  if (cached) return cached;

  const github = readExtra().github;
  const clientId = github?.clientId?.trim();
  const appSlug = github?.appSlug?.trim();

  if (!clientId || !appSlug) return null;

  cached = { clientId, appSlug };
  return cached;
}

export function isGitHubConfigured(): boolean {
  return getGitHubConfig() !== null;
}

export const GITHUB_SETUP_INSTRUCTIONS = [
  'Create a GitHub App at github.com/settings/apps/new',
  'Enable "Device Flow" in its settings',
  'Set Repository permissions -> Contents: Read-only',
  'Keep user-to-server token expiration ENABLED',
  'Copy the Client ID (Iv23li...) and the app slug from its URL',
  'Paste both into app.json -> expo.extra.github, then restart with: npx expo start -c',
].join('\n');

/**
 * Throws a developer-facing error naming the exact fix. Called from the API and
 * auth layers so a missing config fails loudly at the boundary rather than
 * producing a confusing 401 from GitHub.
 */
export function requireGitHubConfig(): GitHubConfig {
  const config = getGitHubConfig();
  if (!config) {
    throw new Error(
      `GitHub is not configured.\n\n${GITHUB_SETUP_INSTRUCTIONS}`,
    );
  }
  return config;
}
