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

/** Reset affordance: forget everything so the next run re-covers the vault. */
export function clearAllCoverage(): void {
  coverageStore.set({ entries: {} });
  persist({});
}
