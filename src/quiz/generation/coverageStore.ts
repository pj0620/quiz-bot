import { createStore } from '../../lib/createStore';
import { readJsonSync, writeJson } from '../../lib/kv';
import { coverageKey, parseCoverage, type NoteCoverage } from './coverage';

/**
 * The persisted coverage ledger. See `coverage.ts` for why it exists.
 *
 * Follows the store convention used everywhere else: module-level
 * `createStore(loadSync())`, a private fire-and-forget `persist`, and exported
 * free functions as the mutation API.
 */

const COVERAGE_KEY = 'quizbot.coverage.v1';

export type CoverageState = { entries: Record<string, NoteCoverage> };

export const coverageStore = createStore<CoverageState>({
  entries: parseCoverage(readJsonSync<unknown>(COVERAGE_KEY)),
});

function persist(entries: Record<string, NoteCoverage>): void {
  void writeJson(COVERAGE_KEY, entries).catch(() => undefined);
}

export function getCoverage(): Record<string, NoteCoverage> {
  return coverageStore.get().entries;
}

export function getCoverageFor(sourceId: string, path: string): NoteCoverage | undefined {
  return coverageStore.get().entries[coverageKey(sourceId, path)];
}

/** Records a successful run over one note, clearing any failure streak. */
export function recordCoverage(entry: {
  sourceId: string;
  path: string;
  contentHash?: string;
  questionCount: number;
  now?: number;
}): void {
  const key = coverageKey(entry.sourceId, entry.path);
  coverageStore.set((state) => {
    const entries = {
      ...state.entries,
      [key]: {
        sourceId: entry.sourceId,
        path: entry.path,
        contentHash: entry.contentHash,
        generatedAt: entry.now ?? Date.now(),
        questionCount: entry.questionCount,
      },
    };
    persist(entries);
    return { entries };
  });
}

/**
 * Records a failure.
 *
 * The content hash is deliberately NOT written: a failed note has not been
 * covered, and storing the hash would mark it done at a version that produced
 * nothing. Only the failure count carries over, so the note is retried on later
 * runs until it hits `MAX_FAILURES`.
 */
export function recordFailure(entry: {
  sourceId: string;
  path: string;
  message: string;
}): void {
  const key = coverageKey(entry.sourceId, entry.path);
  coverageStore.set((state) => {
    const previous = state.entries[key];
    const entries = {
      ...state.entries,
      [key]: {
        sourceId: entry.sourceId,
        path: entry.path,
        contentHash: previous?.contentHash,
        generatedAt: previous?.generatedAt ?? 0,
        questionCount: previous?.questionCount ?? 0,
        failures: (previous?.failures ?? 0) + 1,
        lastError: entry.message,
      },
    };
    persist(entries);
    return { entries };
  });
}

/** Called when a source is disconnected — its coverage is meaningless without it. */
export function clearCoverageForSource(sourceId: string): void {
  coverageStore.set((state) => {
    const entries = Object.fromEntries(
      Object.entries(state.entries).filter(([, entry]) => entry.sourceId !== sourceId),
    );
    if (Object.keys(entries).length === Object.keys(state.entries).length) return state;
    persist(entries);
    return { entries };
  });
}

/** Notes that were read and yielded nothing. */
export function countEmptyCoverage(): number {
  return Object.values(coverageStore.get().entries).filter(
    (entry) => entry.generatedAt > 0 && entry.questionCount === 0,
  ).length;
}

/**
 * Forgets the notes that produced no questions, so the next run retries them.
 *
 * A note read for nothing is recorded as covered, which is right while the
 * reason is genuine — a page of screenshots should not be paid for twice. It is
 * wrong when the reason was a bug in ours: notes skipped by an over-strict rule
 * were marked done at their current hash and would never have been looked at
 * again, short of editing every one of them.
 *
 * Narrower than clearing everything, which would re-generate the whole vault at
 * full price to reach a handful of notes.
 */
export function clearEmptyCoverage(): number {
  let removed = 0;
  coverageStore.set((state) => {
    const entries: Record<string, NoteCoverage> = {};
    for (const [key, entry] of Object.entries(state.entries)) {
      if (entry.generatedAt > 0 && entry.questionCount === 0) {
        removed += 1;
        continue;
      }
      entries[key] = entry;
    }
    if (removed === 0) return state;
    persist(entries);
    return { entries };
  });
  return removed;
}

/** Reset affordance: forget everything so the next run re-covers the vault. */
export function clearAllCoverage(): void {
  coverageStore.set({ entries: {} });
  persist({});
}
