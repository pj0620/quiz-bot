import { assertSecureStore, deleteSecret, readSecret, writeSecret } from '../../../lib/secureStore';
import type { LlmProviderId } from '../types';

/**
 * API keys, one entry per provider.
 *
 * Per-provider rather than a single "current key" so switching provider and
 * back doesn't silently discard a key the user pasted, and so both can be
 * configured at once.
 *
 * The key is only ever read to make a request. Nothing displays it back —
 * settings shows whether one is set, never the value.
 */
function keyFor(providerId: LlmProviderId): string {
  return `quizbot.llm.key.${providerId}.v1`;
}

export async function readApiKey(providerId: LlmProviderId): Promise<string | null> {
  const value = await readSecret(keyFor(providerId));
  return value && value.trim() ? value : null;
}

export async function writeApiKey(providerId: LlmProviderId, apiKey: string): Promise<void> {
  assertSecureStore('saving an API key');
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('An API key cannot be empty.');
  await writeSecret(keyFor(providerId), trimmed);
}

export async function deleteApiKey(providerId: LlmProviderId): Promise<void> {
  await deleteSecret(keyFor(providerId));
}
