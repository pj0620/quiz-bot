import { createStore } from '../../lib/createStore';
import { AppError, toAppError } from '../../lib/errors';
import { isStorageDegraded } from '../../lib/kv';
import { QUIZ_FOLDER } from '../../notes/paths';
import { getSourceType } from '../../sources/registry';
import { getSourceById } from '../../sources/store';
import type { InfoSource, SourceFileEntry } from '../../sources/types';
import { getPlan } from '../builder/store';
import { getQuestions, getReviewStates } from '../store';
import { applySyncResult, describeSync, emptyLedger, planSync, type SkippedFile, type SyncLedger } from './diff';
import { loadLedger, saveLedger } from './ledger';
import { getSyncSettings, setSyncFolder } from './settings';

/**
 * One sync: list the repository, plan what changed, commit it, remember it.
 *
 * Single-flight. A second call while one is running gets the running one's
 * promise, so the manual button and the automatic trigger cannot race each
 * other into two commits with the same parent.
 */

export type SyncPhase =
  | 'idle'
  | 'checking'
  | 'writing'
  | 'done'
  | 'error'
  | 'no-write-access'
  | 'no-target';

export type SyncStatus = {
  phase: SyncPhase;
  running: boolean;
  lastSyncAt?: number;
  /** From the ledger: what the vault holds right now. */
  fileCount: number;
  questionCount: number;
  folder?: string;
  /** The last commit this app made, for "Open on GitHub". */
  lastRevision?: string;
  lastMessage?: string;
  /** Files edited in the vault by hand, which the app will not overwrite. */
  skipped: SkippedFile[];
  /** Questions the note format cannot hold. */
  unwritable: number;
  error?: AppError;
  /** Where to grant access, when the phase is `no-write-access`. */
  manageUrl?: string;
  reason?: string;
};

function statusFromLedger(ledger: SyncLedger | null): Pick<SyncStatus, 'lastSyncAt' | 'fileCount' | 'questionCount' | 'folder'> {
  if (!ledger) return { fileCount: 0, questionCount: 0 };
  return {
    lastSyncAt: ledger.lastSyncAt,
    fileCount: Object.keys(ledger.files).length,
    questionCount: Object.keys(ledger.owner).length,
    folder: ledger.folder,
  };
}

export const syncStatusStore = createStore<SyncStatus>({
  phase: 'idle',
  running: false,
  skipped: [],
  unwritable: 0,
  ...statusFromLedger(loadLedger()),
});

function patchStatus(patch: Partial<SyncStatus>): void {
  syncStatusStore.set({ ...syncStatusStore.get(), ...patch });
}

export function useSyncStatus(): SyncStatus {
  return syncStatusStore.use();
}

/**
 * Where the quiz folder goes when nothing has been chosen yet: beside the
 * vault's `.obsidian` directory, because a folder outside the vault root is
 * one Obsidian never shows. With no vault, or more than one, the repository
 * root is the only honest default.
 */
export function detectFolder(files: readonly SourceFileEntry[]): string {
  const roots = new Set<string>();
  for (const file of files) {
    const match = /^(.*?)(?:^|\/)\.obsidian\//.exec(file.path);
    if (match) roots.add(match[1].replace(/\/$/, ''));
  }
  if (roots.size !== 1) return QUIZ_FOLDER;
  const [root] = Array.from(roots);
  return root ? `${root}/${QUIZ_FOLDER}` : QUIZ_FOLDER;
}

function planTitle(planId: string): string | undefined {
  const plan = getPlan(planId);
  return plan?.accepted?.title ?? plan?.spec?.title;
}

let inFlight: Promise<SyncStatus> | null = null;

export function runSync(): Promise<SyncStatus> {
  if (inFlight) return inFlight;
  inFlight = performSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function isSyncRunning(): boolean {
  return inFlight !== null;
}

async function performSync(): Promise<SyncStatus> {
  const settings = getSyncSettings();
  const source = settings.sourceId ? getSourceById(settings.sourceId) : undefined;
  if (!source) {
    patchStatus({ phase: 'no-target', running: false, error: undefined });
    return syncStatusStore.get();
  }

  patchStatus({ phase: 'checking', running: true, error: undefined, manageUrl: undefined, reason: undefined });
  try {
    if (isStorageDegraded()) {
      throw new AppError('storage', {
        message: 'Storage could not be read on this launch, so nothing is synced until it recovers.',
      });
    }
    const definition = getSourceType(source);
    const { provider } = definition;
    if (!provider.canWrite || !provider.writeFiles) {
      throw new AppError('unknown', { message: 'This kind of source cannot be written to.' });
    }

    const access = await provider.canWrite(source);
    if (!access.ok) {
      patchStatus({ phase: 'no-write-access', running: false, manageUrl: access.manageUrl, reason: access.reason });
      return syncStatusStore.get();
    }

    // One retry on a conflict: someone pushed between the listing and the
    // commit, so the plan is rebuilt against the new head and tried once more.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await commitOnce(source, provider.writeFiles.bind(provider), provider.listFiles.bind(provider));
        break;
      } catch (error) {
        if (toAppError(error).code === 'github_write_conflict' && attempt === 0) continue;
        throw error;
      }
    }
    return syncStatusStore.get();
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'github_forbidden') {
      const definition = getSourceType(source);
      patchStatus({
        phase: 'no-write-access',
        running: false,
        manageUrl: definition.getManageUrl(source),
        reason: appError.message,
      });
    } else {
      patchStatus({ phase: 'error', running: false, error: appError });
    }
    return syncStatusStore.get();
  }
}

type ListFiles = (source: InfoSource) => Promise<{ files: SourceFileEntry[] }>;
type WriteFiles = NonNullable<ReturnType<typeof getSourceType>['provider']['writeFiles']>;

async function commitOnce(source: InfoSource, writeFiles: WriteFiles, listFiles: ListFiles): Promise<void> {
  const now = Date.now();
  const listing = await listFiles(source);
  const tree: Record<string, string> = {};
  for (const file of listing.files) {
    if (file.contentHash) tree[file.path] = file.contentHash;
  }

  let folder = getSyncSettings().folder;
  if (!folder) {
    folder = detectFolder(listing.files);
    setSyncFolder(folder);
  }

  let ledger = loadLedger();
  if (!ledger || ledger.sourceId !== source.id || ledger.folder !== folder) {
    ledger = emptyLedger(source.id, folder);
  }

  const plan = planSync({
    questions: getQuestions(),
    reviewStates: getReviewStates(),
    ledger,
    tree,
    now,
    planTitle,
  });

  let revision: string | undefined;
  let hashes: Record<string, string> = {};
  const message = describeSync(plan.counts);
  if (plan.writes.length > 0 || plan.deletes.length > 0) {
    patchStatus({ phase: 'writing' });
    const result = await writeFiles(
      source,
      [
        ...plan.writes.map((write) => ({ path: write.path, content: write.content })),
        ...plan.deletes.map((path) => ({ path, delete: true as const })),
      ],
      message,
    );
    revision = result.revision;
    hashes = result.contentHashes;
  }

  ledger = applySyncResult(ledger, plan, hashes, now);
  await saveLedger(ledger);

  patchStatus({
    phase: 'done',
    running: false,
    ...statusFromLedger(ledger),
    skipped: plan.skipped,
    unwritable: plan.unwritable.length,
    ...(revision ? { lastRevision: revision, lastMessage: message } : {}),
  });
}
