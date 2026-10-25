import { createStore } from '../../lib/createStore';
import { readJsonSync, writeJson } from '../../lib/kv';

/**
 * Which repository the bank is synced to, where in it, and whether that
 * happens on its own.
 *
 * Its own store, following `src/quiz/preferences.ts`: these change for
 * different reasons than how quizzes draw questions.
 */

const SETTINGS_KEY = 'quizbot.sync.settings.v1';

export type SyncSettings = {
  /** The connected source that receives the files. Absent until chosen. */
  sourceId?: string;
  /**
   * Folder inside the repository, e.g. `notes/quizzes`. Absent until the first
   * sync works it out from where `.obsidian` sits, after which it is pinned so
   * a vault reorganisation cannot silently move the files.
   */
  folder?: string;
  /** Sync on its own after the bank or a review changes. */
  auto: boolean;
};

const DEFAULTS: SyncSettings = { auto: true };

function loadSync(): SyncSettings {
  const stored = readJsonSync<Partial<SyncSettings>>(SETTINGS_KEY);
  if (!stored) return DEFAULTS;
  return {
    ...(typeof stored.sourceId === 'string' && stored.sourceId ? { sourceId: stored.sourceId } : {}),
    ...(typeof stored.folder === 'string' && stored.folder ? { folder: stored.folder } : {}),
    auto: typeof stored.auto === 'boolean' ? stored.auto : DEFAULTS.auto,
  };
}

export const syncSettingsStore = createStore<SyncSettings>(loadSync());

function update(patch: Partial<SyncSettings>): void {
  const next: SyncSettings = { ...syncSettingsStore.get(), ...patch };
  for (const key of ['sourceId', 'folder'] as const) {
    if (next[key] === undefined) delete next[key];
  }
  syncSettingsStore.set(next);
  // Fire-and-forget: a failed preference write must not break the screen.
  void writeJson(SETTINGS_KEY, next).catch(() => undefined);
}

export function setSyncSource(sourceId: string | undefined): void {
  // A different repository starts from nothing: the folder is worked out
  // again, and the ledger (keyed by source) is replaced on the next sync.
  update({ sourceId, folder: undefined });
}

/** A trimmed, slash-normalised folder; empty means the repository root. */
export function normalizeFolder(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

export function setSyncFolder(folder: string | undefined): void {
  update({ folder: folder === undefined ? undefined : normalizeFolder(folder) });
}

export function setSyncAuto(auto: boolean): void {
  update({ auto });
}

export function getSyncSettings(): SyncSettings {
  return syncSettingsStore.get();
}

export function useSyncSettings(): SyncSettings {
  return syncSettingsStore.use();
}
