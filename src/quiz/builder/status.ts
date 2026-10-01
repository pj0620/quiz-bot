import type { PlanJob } from './runStore';
import {
  batchLabel,
  hasKeptAnything,
  hasUnacceptedChanges,
  openBatch,
  type QuizPlan,
} from './types';

/**
 * What a plan is doing, in a word and a line.
 *
 * One function, so the Build tab's row and the plan's own screen can never
 * disagree about whether something is waiting on the reader. The order is a
 * priority — the first thing true is the thing worth saying: work in progress,
 * then anything the reader has to act on, then where the plan stands.
 */

export type PlanStatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export type PlanStatus = {
  /** The badge: one word. */
  label: string;
  tone: PlanStatusTone;
  /** The row's subtitle: what, specifically. */
  detail: string;
  /** True when the plan is waiting on the reader rather than the other way round. */
  needsYou: boolean;
};

export function planStatus(
  plan: QuizPlan,
  context: { job: PlanJob | null; thinking: boolean; freshCount: number; questionCount: number },
): PlanStatus {
  const { job, thinking, freshCount, questionCount } = context;

  if (job?.planId === plan.id) {
    const batch = plan.batches.find((entry) => entry.id === job.batchId);
    if (job.kind === 'fix') {
      return { label: 'Fixing', tone: 'primary', detail: 'Rewriting the questions you flagged…', needsYou: false };
    }
    const done = batch?.notes.filter((note) => note.status !== 'pending' && note.status !== 'running').length ?? 0;
    const total = batch?.notes.length ?? 0;
    return {
      label: 'Writing',
      tone: 'primary',
      detail: `${batch ? batchLabel(plan, batch) : 'A batch'}: ${batch?.drafts.length ?? 0} written · ${done} of ${total} notes read`,
      needsYou: false,
    };
  }

  const open = openBatch(plan);
  if (open?.status === 'review') {
    return {
      label: 'Review',
      tone: 'warning',
      detail: `${batchLabel(plan, open)}: ${open.drafts.length} question${open.drafts.length === 1 ? '' : 's'} ready to review`,
      needsYou: true,
    };
  }

  if (!plan.accepted) {
    if (thinking) return { label: 'Drafting', tone: 'neutral', detail: 'The planner is thinking…', needsYou: false };
    return {
      label: 'Drafting',
      tone: 'neutral',
      detail: plan.spec ? `Plan v${plan.spec.version} is ready for you to accept` : 'Waiting for a first plan',
      needsYou: !!plan.spec,
    };
  }

  if (hasUnacceptedChanges(plan) && plan.spec) {
    return {
      label: 'Changes',
      tone: 'primary',
      detail: `Plan v${plan.spec.version} is waiting for you to accept it`,
      needsYou: true,
    };
  }

  if (freshCount > 0) {
    return {
      label: 'New notes',
      tone: 'primary',
      detail: `${freshCount} new note${freshCount === 1 ? '' : 's'} to write questions for`,
      needsYou: true,
    };
  }

  if (!hasKeptAnything(plan)) {
    return { label: 'Ready', tone: 'neutral', detail: 'Try a few sample questions', needsYou: true };
  }

  const mode = plan.settings.mode === 'autopilot';
  return {
    label: mode ? 'Autopilot' : 'Active',
    tone: 'success',
    detail: `${questionCount} question${questionCount === 1 ? '' : 's'} in your bank`,
    needsYou: false,
  };
}
