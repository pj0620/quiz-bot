/**
 * What has already been generated from, and at what version.
 *
 * This is not an optimisation. Question ids are derived from prompt text, so
 * two runs over the same note produce differently-worded questions with
 * different ids — and since edits keep the old questions rather than replacing
 * them, nothing downstream would catch the duplicates. Coverage is the only
 * thing that stops a second run paying to re-read notes it already covered and
 * quietly doubling the bank.
 *
 * Deliberately dependency-free: the persisted store lives in `coverageStore.ts`,
 * which pulls in kv and therefore a native module. Keeping the shape and the
 * pure helpers here is what lets `selectNotes` — the rule that decides where
 * money goes — be tested with no mocks at all.
 */

/** A note that fails this many times running is left alone. */
export const MAX_FAILURES = 3;

export type NoteCoverage = {
  sourceId: string;
  path: string;
  /** Provider content marker at the time of generation — a Git blob SHA. */
  contentHash?: string;
  /** 0 means "attempted but never succeeded". */
  generatedAt: number;
  questionCount: number;
  /** Consecutive failures. Reset by a success. */
  failures?: number;
  lastError?: string;
};

/** Keyed by source too, because a path is only unique within one source. */
export function coverageKey(sourceId: string, path: string): string {
  return `${sourceId}:${path}`;
}

export function isValidCoverage(value: unknown): value is NoteCoverage {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<NoteCoverage>;
  return (
    typeof entry.sourceId === 'string' &&
    typeof entry.path === 'string' &&
    typeof entry.generatedAt === 'number' &&
    typeof entry.questionCount === 'number'
  );
}

/**
 * A malformed row is dropped on its own rather than discarding the ledger.
 *
 * Losing one entry means one note gets generated from twice; losing the whole
 * ledger means paying to re-read the entire vault.
 */
export function parseCoverage(stored: unknown): Record<string, NoteCoverage> {
  if (!stored || typeof stored !== 'object') return {};

  const entries: Record<string, NoteCoverage> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (isValidCoverage(value)) entries[key] = value;
  }
  return entries;
}
