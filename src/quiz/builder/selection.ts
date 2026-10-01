import { coverageKey } from '../generation/coverage';
import type { NoteCandidate } from '../generation/selectNotes';
import { MAX_NOTE_FAILURES, type PlanNoteCoverage } from './types';

/**
 * Which of a plan's notes the next batch reads, and in what order.
 *
 * Pure, for the reason `generation/selectNotes.ts` gives: this is the rule
 * that decides where money goes, so it is tested without a network, a provider
 * or a store.
 *
 * The order is a priority:
 *
 *   1. fresh   — turned up or changed since the plan last looked. What the
 *                reader just studied, so it jumps the queue.
 *   2. backlog — in scope, never read under this plan. Book order, so a plan
 *                works through a book from the beginning.
 *   3. deeper  — read fewer times than the plan's depth allows. Least-read
 *                first, so a second pass sweeps the whole book before any
 *                note is read a third time.
 *
 * Anything read `depth` times, unchanged since, is DONE and never selected —
 * re-reading it would only buy near-duplicates of questions the reader has.
 */

export type NoteTier = 'fresh' | 'backlog' | 'deeper';

export type PlanNoteChoice = NoteCandidate & { tier: NoteTier; passes: number };

type CoverageMap = Readonly<Record<string, PlanNoteCoverage>>;
type SeenMap = Readonly<Record<string, string>>;

/**
 * New to the plan, or edited since it was acknowledged.
 *
 * A note with no hash on either side cannot be judged changed, and is treated
 * as unchanged: re-reading it on every check would bill the reader forever.
 */
export function isFresh(note: NoteCandidate, seen: SeenMap): boolean {
  const seenHash = seen[coverageKey(note.sourceId, note.path)];
  if (seenHash === undefined) return true;
  return seenHash !== '' && !!note.contentHash && seenHash !== note.contentHash;
}

function failedOut(coverage: PlanNoteCoverage | undefined): boolean {
  return (coverage?.failures ?? 0) >= MAX_NOTE_FAILURES;
}

/** Fresh notes in scope, in book order — what the watcher acts on. */
export function freshNotes(
  matched: readonly NoteCandidate[],
  seen: SeenMap,
  coverage: CoverageMap,
): NoteCandidate[] {
  return matched.filter(
    (note) => isFresh(note, seen) && !failedOut(coverage[coverageKey(note.sourceId, note.path)]),
  );
}

/**
 * Every note a batch could read, best first. `matched` must already be in book
 * order — `resolveScope` returns it that way.
 */
export function orderForBatch(input: {
  matched: readonly NoteCandidate[];
  coverage: CoverageMap;
  seen: SeenMap;
  depth: number;
}): PlanNoteChoice[] {
  const { matched, coverage, seen, depth } = input;
  const fresh: PlanNoteChoice[] = [];
  const backlog: PlanNoteChoice[] = [];
  const deeper: PlanNoteChoice[] = [];

  for (const note of matched) {
    const entry = coverage[coverageKey(note.sourceId, note.path)];
    if (failedOut(entry)) continue;
    const passes = entry?.passes ?? 0;

    if (isFresh(note, seen)) fresh.push({ ...note, tier: 'fresh', passes });
    else if (passes === 0) backlog.push({ ...note, tier: 'backlog', passes });
    else if (passes < depth) deeper.push({ ...note, tier: 'deeper', passes });
  }

  // Stable sort: equal passes keep book order.
  deeper.sort((a, b) => a.passes - b.passes);

  return [...fresh, ...backlog, ...deeper];
}

/**
 * Notes for the sample batch: spread across the scope rather than its first
 * few, so the reader judges the plan on the whole book and not on chapter one.
 */
export function pickSampleNotes(matched: readonly NoteCandidate[], count: number): NoteCandidate[] {
  if (count <= 0) return [];
  if (matched.length <= count) return matched.slice();
  const step = matched.length / count;
  const picked: NoteCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(matched[Math.min(matched.length - 1, Math.floor(index * step + step / 2))]);
  }
  return picked;
}

export type PlanProgress = {
  /** Notes in scope. */
  total: number;
  /** Read at least once under this plan. */
  read: number;
  /** Read `depth` times — nothing left to ask of them. */
  complete: number;
  /** Given up on after repeated failures. */
  failed: number;
};

export function planProgress(
  matched: readonly NoteCandidate[],
  coverage: CoverageMap,
  depth: number,
): PlanProgress {
  let read = 0;
  let complete = 0;
  let failed = 0;
  for (const note of matched) {
    const entry = coverage[coverageKey(note.sourceId, note.path)];
    if (failedOut(entry)) failed += 1;
    if ((entry?.passes ?? 0) > 0) read += 1;
    if ((entry?.passes ?? 0) >= depth) complete += 1;
  }
  return { total: matched.length, read, complete, failed };
}

/**
 * How a batch should be split across notes: each note is asked for the plan's
 * full density, and notes are added until the expected total reaches the
 * batch size — the rest is `runStore`'s top-up. Exported for its test.
 */
export function notesForSize(size: number, questionsPerNote: number): number {
  if (size <= 0) return 0;
  return Math.max(1, Math.ceil(size / Math.max(1, questionsPerNote)));
}
