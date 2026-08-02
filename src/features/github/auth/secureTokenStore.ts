import { assertSecureStore, deleteSecret, readSecret, writeSecret } from '../../../lib/secureStore';
import type { GitHubTokenRecord } from '../types';

/**
 * The GitHub token's storage policy.
 *
 * Raw Keychain/Keystore access lives in `src/lib/secureStore.ts`; what belongs
 * here is what makes a stored record *valid* — the shape, the version, and
 * whether it still belongs to the GitHub App this build is configured for.
 */
const KEY = 'quizbot.github.token.v1';

/**
 * Reads and validates the stored record.
 *
 * Defensive on purpose: a record from an older version, or one belonging to a
 * different GitHub App, must not produce a crash loop. In every such case we
 * delete the key and report "no token", which routes the user into a normal
 * reconnect.
 */
export async function readTokenRecord(expectedClientId: string): Promise<GitHubTokenRecord | null> {
  assertSecureStore('GitHub sign-in');

  const raw = await readSecret(KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await deleteTokenRecord().catch(() => undefined);
    return null;
  }

  const record = parsed as Partial<GitHubTokenRecord>;
  const valid =
    record !== null &&
    typeof record === 'object' &&
    record.version === 1 &&
    typeof record.accessToken === 'string' &&
    record.accessToken.length > 0 &&
    typeof record.clientId === 'string' &&
    typeof record.issuedAt === 'number';

  if (!valid || record.clientId !== expectedClientId) {
    await deleteTokenRecord().catch(() => undefined);
    return null;
  }

  return record as GitHubTokenRecord;
}

export async function writeTokenRecord(record: GitHubTokenRecord): Promise<void> {
  assertSecureStore('GitHub sign-in');
  await writeSecret(KEY, JSON.stringify(record));
}

export async function deleteTokenRecord(): Promise<void> {
  await deleteSecret(KEY);
}
