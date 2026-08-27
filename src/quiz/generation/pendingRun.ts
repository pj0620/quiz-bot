import { readJsonSync, removeItem, writeJson } from '../../lib/kv';
import type { StartRunOptions } from './runStore';

/**
 * The persisted record of a run that has started and not yet ended.
 *
 * `runStore` holds a run's live state in memory, which is exactly right while
 * the app is alive — and worthless the moment iOS suspends or kills it. This
 * record is the part that must survive that: enough to RESUME the run from a
 * background task launch, not to display it. See `backgroundResume.ts`.
 *
 * `notesDone` exists for cost control. A resume re-selects notes, and coverage
 * already keeps it from re-reading finished ones — but without a count, a run
 * budgeted at eight notes that finished six before being killed would happily
 * pick eight MORE. Counting every settled note (failures included, matching the
 * poller's own accounting) keeps the original budget the real ceiling.
 */

const KEY = 'quizbot.generation.pendingRun.v1';

export type PendingRun = {
  options: StartRunOptions;
  startedAt: number;
  /** Notes that reached a result — success or failure — before any interruption. */
  notesDone: number;
};

/*
  Memory is the source of truth while the app is alive; kv is only consulted on
  the first read after a launch. Two reasons: increments arrive per note and a
  read-modify-write against async storage would race itself, and a degraded
  storage layer must not make a live run forget that it is running.
*/
let cached: PendingRun | null | undefined;

const listeners = new Set<() => void>();

/** Fires on save and clear — the register/unregister moments for the resume task. */
export function onPendingRunChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(): void {
  // A courtesy write: failing to persist must never break the run itself,
  // which is why every error here is swallowed rather than thrown.
  const write = cached === null ? removeItem(KEY) : writeJson(KEY, cached);
  void write.catch(() => {});
}

export function getPendingRun(): PendingRun | null {
  if (cached === undefined) cached = readJsonSync<PendingRun>(KEY);
  return cached;
}

export function savePendingRun(options: StartRunOptions): void {
  cached = { options, startedAt: Date.now(), notesDone: 0 };
  persist();
  for (const listener of [...listeners]) listener();
}

/** Called once per settled note, so a resume knows how much budget is left. */
export function recordPendingNote(): void {
  const pending = getPendingRun();
  if (!pending) return;
  cached = { ...pending, notesDone: pending.notesDone + 1 };
  persist();
}

export function clearPendingRun(): void {
  if (getPendingRun() === null) return;
  cached = null;
  persist();
  for (const listener of [...listeners]) listener();
}
