import { AppState, type AppStateStatus } from 'react-native';

import { CATALOG_MAX_AGE_MS, refreshCatalog } from './notesCatalog';
import { isPlanJobRunning, startPlanBatch } from './runStore';
import { resolveScope } from './scope';
import { freshNotes } from './selection';
import { baselinePlan, getPlans } from './store';
import { hasKeptAnything, openBatch } from './types';

/**
 * Noticing new notes, and writing questions for them.
 *
 * The reader adds a note in Obsidian; it reaches the app only when the app
 * next lists the repository. So this checks when the app comes to the
 * foreground — at most every half hour, since each check is a tree request per
 * source — and for every plan set to "write questions for new notes", turns
 * notes that arrived since the plan's baseline into a batch. Under review mode
 * that batch waits for the reader, flagged on the Build tab; on autopilot it
 * goes straight into the bank.
 *
 * Foreground only, deliberately. The background-task slot is the note run's,
 * and a plan writing unprompted while the phone sits in a pocket — on the OS's
 * schedule, spending the reader's money — is a different promise from "the app
 * caught up when I opened it". One plan per check, for the same reason: the
 * rest catch up on the next.
 */

export const CHECK_INTERVAL_MS = 30 * 60_000;

/** Let launch work finish first — the check is never urgent. */
const FIRST_CHECK_DELAY_MS = 5_000;

let lastCheckAt = 0;
let checking: Promise<void> | null = null;
let initialised = false;

export async function checkPlansForNewNotes(options: { force?: boolean } = {}): Promise<void> {
  if (checking) return checking;
  if (!getPlans().some((plan) => plan.accepted)) return;
  if (!options.force && Date.now() - lastCheckAt < CHECK_INTERVAL_MS) return;

  checking = (async () => {
    lastCheckAt = Date.now();
    const catalog = await refreshCatalog({ maxAgeMs: options.force ? 0 : CATALOG_MAX_AGE_MS });
    // A partial listing would make the silent source's notes look new.
    if (catalog.status !== 'ready' || !catalog.complete) return;

    let started = false;
    // Re-read per plan: a baseline or a batch started above changes the state below.
    for (const { id } of getPlans()) {
      const plan = getPlans().find((entry) => entry.id === id);
      if (!plan?.accepted) continue;
      const matched = resolveScope(catalog.notes, plan.accepted.scope);

      if (plan.baselinedAt === undefined) {
        baselinePlan(plan.id, matched);
        continue;
      }

      if (started || isPlanJobRunning()) continue;
      // Only a plan the reader has actually put to work. One still being
      // sampled has nothing agreed to extend yet.
      if (!plan.settings.autoNewNotes || !hasKeptAnything(plan) || openBatch(plan)) continue;
      if (freshNotes(matched, plan.seen, plan.coverage).length === 0) continue;

      const outcome = await startPlanBatch(plan.id, { kind: 'new-notes' });
      started = outcome.ok;
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      checking = null;
    });

  return checking;
}

/** Called once from the root layout. */
export function initPlanWatcher(): void {
  if (initialised) return;
  initialised = true;
  setTimeout(() => void checkPlansForNewNotes(), FIRST_CHECK_DELAY_MS);
  AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') void checkPlansForNewNotes();
  });
}

/** Test seam. */
export function resetWatcherForTests(): void {
  lastCheckAt = 0;
  checking = null;
}
