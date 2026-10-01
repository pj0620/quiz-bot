import { feedbackDigest } from './feedback';
import { refreshCatalog } from './notesCatalog';
import { cancelPlannerTurn, runPlannerFor } from './planner';
import { cancelPlanJob, planRunStore, startPlanBatch, type StartOutcome } from './runStore';
import { resolveScope } from './scope';
import {
  acceptBatch,
  acceptSpec,
  appendMessage,
  baselinePlan,
  createPlan,
  deletePlan,
  getPlan,
  saveHandEdit,
  updatePlanSettings,
} from './store';
import { batchLabel, hasKeptBatch, type PlanSpec, type QuizPlan } from './types';

/**
 * The steps of the builder flow, each one tap in the UI.
 *
 * Kept out of the screens so the flow reads in one place — describe, agree,
 * sample, review, continue — and so every screen that offers a step offers
 * the same step, rather than three slightly different versions of "accept".
 */

/** A new plan from the reader's request, with the planner already answering. */
export function startNewPlan(request: string): QuizPlan {
  const plan = createPlan(request);
  void runPlannerFor(plan.id);
  return plan;
}

/**
 * Agrees the working plan, then baselines the notes it reads — every note in
 * scope at this moment is backlog, not news (see `seen`). Skipped on a partial
 * listing, which would make the missing source's notes look new later; the
 * watcher baselines on its next complete one instead.
 */
export async function acceptPlan(planId: string): Promise<PlanSpec | null> {
  const accepted = acceptSpec(planId);
  if (!accepted) return null;
  const catalog = await refreshCatalog();
  if (catalog.status === 'ready' && catalog.complete) {
    baselinePlan(planId, resolveScope(catalog.notes, accepted.scope));
  }
  return accepted;
}

/**
 * Accepts and writes in one go: the next batch for a plan already in use,
 * samples for one still being tried out — which is the only thing a reader
 * accepting a plan ever wants to happen next.
 *
 * "In use" means a real batch kept, not samples: a plan rethought after its
 * samples is a new plan to try, and earns new samples of its own.
 */
export async function acceptAndWrite(planId: string): Promise<StartOutcome> {
  await acceptPlan(planId);
  const plan = getPlan(planId);
  return startPlanBatch(planId, { kind: plan && hasKeptBatch(plan) ? 'batch' : 'sample' });
}

/**
 * Saves a hand edit and, on a plan in use, baselines what it now reads. A
 * widened scope's new notes are backlog the reader just chose — calling them
 * "new notes" would have the watcher write for them unprompted.
 */
export async function saveEdit(planId: string, edited: PlanSpec): Promise<void> {
  const saved = saveHandEdit(planId, edited);
  const plan = getPlan(planId);
  if (!saved || !plan?.accepted || plan.accepted.version !== saved.version) return;
  const catalog = await refreshCatalog();
  if (catalog.status === 'ready' && catalog.complete) {
    baselinePlan(planId, resolveScope(catalog.notes, saved.scope));
  }
}

/** Stops anything the plan has in flight, then deletes it — nothing is spent on a plan that is gone. */
export function removePlan(planId: string, options: { withQuestions: boolean }): void {
  if (planRunStore.get().job?.planId === planId) cancelPlanJob();
  cancelPlannerTurn(planId);
  deletePlan(planId, options);
}

/** Keeps a batch and starts the next — the loop at the heart of the flow. */
export async function keepAndContinue(planId: string, batchId: string, size?: number): Promise<StartOutcome> {
  acceptBatch(planId, batchId);
  if (size !== undefined) updatePlanSettings(planId, { batchSize: size });
  return startPlanBatch(planId, { kind: 'batch', ...(size !== undefined ? { size } : {}) });
}

/**
 * "Rethink the plan": the questions the reader did not flag are kept — they
 * were paid for and approved — and the review goes to the planner as a
 * message, which it answers with a revised plan for the reader to accept.
 *
 * The digest is written BEFORE the batch is kept, because keeping it empties
 * the drafts the digest quotes.
 */
export function rethinkWithFeedback(planId: string, batchId: string): boolean {
  const plan = getPlan(planId);
  const batch = plan?.batches.find((entry) => entry.id === batchId);
  if (!plan || !batch || batch.status !== 'review') return false;

  const digest = feedbackDigest(batch, batchLabel(plan, batch));
  acceptBatch(planId, batchId);
  appendMessage(planId, { role: 'user', text: digest, kind: 'feedback' });
  // Supersede, not queue behind: a turn already thinking cannot see the digest.
  void runPlannerFor(planId, { supersede: true });
  return true;
}
