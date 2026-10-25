import { hashString } from '../../lib/random';
import type { Question, ReviewState } from '../types';
import { quizFilePath, renderFolderReadme, renderQuizFile } from './format';

/**
 * What a sync has to write, decided without touching the network.
 *
 * The ledger remembers which file owns each question and what each file looked
 * like when it was last written. A sync then re-renders every file from the
 * bank and writes only the ones whose text changed — there is no second
 * notion of "changed" to keep in step with the renderer.
 *
 * Two rules protect the reader's own edits:
 *
 *  - A file whose blob in the repo is not the one this app last wrote has been
 *    edited by hand. It is skipped, reported, and keeps owning its questions,
 *    so nothing is duplicated into a fresh file and nothing the reader wrote
 *    is overwritten. Import is what reconciles it.
 *  - A file missing from the repo is written again at its own path. The app
 *    owns the folder; removing a file is not a way to unsync its questions.
 */

export type SyncLedgerFile = {
  /** The blob sha this app wrote last. Anything else in the repo is a hand edit. */
  blobSha: string;
  renderedHash: number;
  questionIds: string[];
  /** When the batch was first written; kept so the file's title never changes. */
  createdAt: number;
};

export type SyncLedger = {
  version: 1;
  sourceId: string;
  folder: string;
  lastSyncAt?: number;
  files: Record<string, SyncLedgerFile>;
  /** Question id -> file path. One file per id, always. */
  owner: Record<string, string>;
};

export function emptyLedger(sourceId: string, folder: string): SyncLedger {
  return { version: 1, sourceId, folder, files: {}, owner: {} };
}

export function isValidLedger(value: unknown): value is SyncLedger {
  if (!value || typeof value !== 'object') return false;
  const ledger = value as Partial<SyncLedger>;
  if (ledger.version !== 1) return false;
  if (typeof ledger.sourceId !== 'string' || typeof ledger.folder !== 'string') return false;
  if (!ledger.files || typeof ledger.files !== 'object') return false;
  if (!ledger.owner || typeof ledger.owner !== 'object') return false;
  return Object.values(ledger.files).every(
    (file) =>
      !!file &&
      typeof file === 'object' &&
      typeof file.blobSha === 'string' &&
      typeof file.renderedHash === 'number' &&
      typeof file.createdAt === 'number' &&
      Array.isArray(file.questionIds) &&
      file.questionIds.every((id) => typeof id === 'string'),
  );
}

export type FileWrite = {
  path: string;
  content: string;
  questionIds: string[];
  renderedHash: number;
  createdAt: number;
  kind: 'new' | 'update' | 'recreate' | 'readme';
};

export type SkippedFile = { path: string; questionIds: string[]; reason: 'edited-outside' };

export type SyncPlan = {
  writes: FileWrite[];
  /** Paths to delete from the repo. */
  deletes: string[];
  /** Ledger entries with nothing left to show and no file to delete. */
  forget: string[];
  skipped: SkippedFile[];
  /** Questions the file format cannot hold. */
  unwritable: { id: string; reason: string }[];
  counts: { added: number; updatedFiles: number; removed: number };
};

export type SyncPlanInput = {
  questions: readonly Question[];
  reviewStates: Readonly<Record<string, ReviewState>>;
  ledger: SyncLedger;
  /** Blob sha by path for everything in the repo right now. */
  tree: Readonly<Record<string, string>>;
  now: number;
  planTitle?: (planId: string) => string | undefined;
};

export function planSync(input: SyncPlanInput): SyncPlan {
  const { questions, reviewStates, ledger, tree, now, planTitle } = input;
  const byId = new Map(questions.map((question) => [question.id, question]));
  const plan: SyncPlan = {
    writes: [],
    deletes: [],
    forget: [],
    skipped: [],
    unwritable: [],
    counts: { added: 0, updatedFiles: 0, removed: 0 },
  };

  const entriesFor = (ids: readonly string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((question): question is Question => question !== undefined)
      .map((question) => ({ question, review: reviewStates[question.id] }));

  for (const [path, file] of Object.entries(ledger.files)) {
    const inRepo = tree[path];
    if (inRepo !== undefined && inRepo !== file.blobSha) {
      plan.skipped.push({ path, questionIds: file.questionIds, reason: 'edited-outside' });
      continue;
    }

    const keptIds = file.questionIds.filter((id) => byId.has(id));
    const removed = file.questionIds.length - keptIds.length;
    const rendered = renderQuizFile(entriesFor(keptIds), { createdAt: file.createdAt, planTitle });
    plan.unwritable.push(...rendered.skipped);

    if (rendered.entries.length === 0) {
      if (inRepo !== undefined) plan.deletes.push(path);
      else plan.forget.push(path);
      plan.counts.removed += removed;
      continue;
    }

    const renderedHash = hashString(rendered.text);
    const kind = inRepo === undefined ? 'recreate' : 'update';
    if (kind === 'update' && renderedHash === file.renderedHash) continue;

    plan.writes.push({
      path,
      content: rendered.text,
      questionIds: rendered.entries.map((entry) => entry.question.id),
      renderedHash,
      createdAt: file.createdAt,
      kind,
    });
    plan.counts.updatedFiles += 1;
    plan.counts.removed += removed;
  }

  const newIds = questions.filter((question) => !ledger.owner[question.id]).map((question) => question.id);
  if (newIds.length > 0) {
    const rendered = renderQuizFile(entriesFor(newIds), { createdAt: now, planTitle });
    plan.unwritable.push(...rendered.skipped);
    if (rendered.entries.length > 0) {
      const taken = new Set([...Object.keys(tree), ...Object.keys(ledger.files), ...plan.writes.map((w) => w.path)]);
      let stamp = now;
      let path = quizFilePath(ledger.folder, stamp);
      while (taken.has(path)) {
        stamp += 1000;
        path = quizFilePath(ledger.folder, stamp);
      }
      plan.writes.push({
        path,
        content: rendered.text,
        questionIds: rendered.entries.map((entry) => entry.question.id),
        renderedHash: hashString(rendered.text),
        createdAt: now,
        kind: 'new',
      });
      plan.counts.added = rendered.entries.length;
    }
  }

  // The explainer, once: on the folder's first sync and only if nobody wrote one.
  const readmePath = `${ledger.folder}/README.md`;
  if (Object.keys(ledger.files).length === 0 && plan.writes.length > 0 && tree[readmePath] === undefined) {
    const content = renderFolderReadme();
    plan.writes.push({
      path: readmePath,
      content,
      questionIds: [],
      renderedHash: hashString(content),
      createdAt: now,
      kind: 'readme',
    });
  }

  return plan;
}

export function describeSync(counts: SyncPlan['counts']): string {
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} new question${counts.added === 1 ? '' : 's'}`);
  if (counts.updatedFiles) parts.push(`${counts.updatedFiles} file${counts.updatedFiles === 1 ? '' : 's'} updated`);
  if (counts.removed) parts.push(`${counts.removed} question${counts.removed === 1 ? '' : 's'} removed`);
  return `QuizBot sync: ${parts.length ? parts.join(', ') : 'no changes'}`;
}

/**
 * The ledger after a plan's writes landed. `blobShas` are what the repo
 * reports for the written paths, so the next sync can tell our own write from
 * a hand edit.
 */
export function applySyncResult(
  ledger: SyncLedger,
  plan: SyncPlan,
  blobShas: Readonly<Record<string, string>>,
  now: number,
): SyncLedger {
  const files = { ...ledger.files };
  const owner = { ...ledger.owner };

  const disown = (path: string, ids: readonly string[]) => {
    for (const id of ids) if (owner[id] === path) delete owner[id];
  };

  for (const write of plan.writes) {
    if (write.kind === 'readme') continue;
    const previous = ledger.files[write.path];
    if (previous) disown(write.path, previous.questionIds.filter((id) => !write.questionIds.includes(id)));
    files[write.path] = {
      blobSha: blobShas[write.path] ?? previous?.blobSha ?? '',
      renderedHash: write.renderedHash,
      questionIds: write.questionIds,
      createdAt: write.createdAt,
    };
    for (const id of write.questionIds) owner[id] = write.path;
  }

  for (const path of [...plan.deletes, ...plan.forget]) {
    const previous = files[path];
    if (!previous) continue;
    disown(path, previous.questionIds);
    delete files[path];
  }

  return { ...ledger, files, owner, lastSyncAt: now };
}
