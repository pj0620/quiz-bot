import { createStore } from '../../../lib/createStore';
import { readJsonSync, removeItem, writeJson } from '../../../lib/kv';
import type { AuthStatus, GitHubConnection } from '../types';

/**
 * Non-secret connection state: who is connected and whether the grant is healthy.
 *
 * Kept separate from the token so that after a failed refresh we can delete the
 * credential but still remember the login — the difference between showing
 * "Reconnect as @octocat" and a generic sign-in prompt.
 */
const KEY = 'quizbot.github.connection.v1';

const initial: GitHubConnection = readJsonSync<GitHubConnection>(KEY) ?? { status: 'unknown' };

export const connectionStore = createStore<GitHubConnection>(initial);

function persist(next: GitHubConnection): void {
  // Fire-and-forget: this is a cache of non-critical metadata, and blocking auth
  // on a kv write would be worse than losing the avatar until the next launch.
  void writeJson(KEY, next).catch(() => undefined);
}

export function setConnection(next: GitHubConnection): void {
  connectionStore.set(next);
  persist(next);
}

export function setStatus(status: AuthStatus): void {
  const next = { ...connectionStore.get(), status };
  connectionStore.set(next);
  persist(next);
}

export function setIdentity(identity: { login: string; avatarUrl?: string }): void {
  const next: GitHubConnection = {
    ...connectionStore.get(),
    status: 'connected',
    login: identity.login,
    avatarUrl: identity.avatarUrl,
    connectedAt: connectionStore.get().connectedAt ?? Date.now(),
  };
  connectionStore.set(next);
  persist(next);
}

export function clearConnection(): void {
  connectionStore.set({ status: 'disconnected' });
  void removeItem(KEY).catch(() => undefined);
}

export function getConnection(): GitHubConnection {
  return connectionStore.get();
}
