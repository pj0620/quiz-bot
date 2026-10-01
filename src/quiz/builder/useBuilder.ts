import { useMemo, useSyncExternalStore } from 'react';

import type { NoteCandidate } from '../generation/selectNotes';
import { useQuestions } from '../useQuiz';
import type { Question } from '../types';
import { catalogStore, type CatalogState } from './notesCatalog';
import { plannerStore, type PlannerTurnState } from './planner';
import { planRunStore, type PlanRunState } from './runStore';
import { resolveScope } from './scope';
import { freshNotes } from './selection';
import { plansStore } from './store';
import { openBatch, planTitle, type PlanSpec, type QuizPlan } from './types';

/**
 * React bindings for quiz plans.
 *
 * The discipline of `useQuiz.ts`: subscribe directly so the stored reference
 * comes back unchanged between renders, and put anything that allocates
 * behind `useMemo` — a selector returning a fresh array fails the Object.is
 * snapshot check and renders forever.
 */

function usePlansRaw(): QuizPlan[] {
  return useSyncExternalStore(
    plansStore.subscribe,
    () => plansStore.get().plans,
    () => plansStore.get().plans,
  );
}

/** Most recently touched first — the order the Build tab lists them in. */
export function usePlans(): QuizPlan[] {
  const plans = usePlansRaw();
  return useMemo(() => [...plans].sort((a, b) => b.updatedAt - a.updatedAt), [plans]);
}

export function usePlan(planId: string | undefined): QuizPlan | undefined {
  const plans = usePlansRaw();
  return useMemo(() => (planId ? plans.find((plan) => plan.id === planId) : undefined), [plans, planId]);
}

export function useCatalog(): CatalogState {
  return catalogStore.use();
}

export function usePlanRun(): PlanRunState {
  return planRunStore.use();
}

export function usePlannerTurn(planId: string | undefined): PlannerTurnState | undefined {
  return plannerStore.useSelector((state) => (planId ? state.turns[planId] : undefined));
}

/** The bank is the authority on a plan's questions — nothing about them is stored twice. */
export function usePlanQuestions(planId: string | undefined): Question[] {
  const questions = useQuestions();
  return useMemo(
    () => (planId ? questions.filter((question) => question.planId === planId) : []),
    [questions, planId],
  );
}

/** The notes a version of the plan reads, in book order, from the shared listing. */
export function useScopeNotes(spec: PlanSpec | null | undefined): readonly NoteCandidate[] {
  const catalog = useCatalog();
  return useMemo(() => (spec ? resolveScope(catalog.notes, spec.scope) : []), [catalog.notes, spec]);
}

/**
 * Notes that turned up for a plan since its baseline. Empty unless the listing
 * is complete and the plan has a baseline — a partial listing, or none, can
 * only produce false alarms.
 */
export function useFreshNotes(plan: QuizPlan | undefined): NoteCandidate[] {
  const catalog = useCatalog();
  return useMemo(() => {
    if (!plan?.accepted || plan.baselinedAt === undefined || !catalog.complete) return [];
    return freshNotes(resolveScope(catalog.notes, plan.accepted.scope), plan.seen, plan.coverage);
  }, [plan, catalog.notes, catalog.complete]);
}

/** Plan titles by id, for rule descriptions and the bank's plan filter. */
export function usePlanNames(): Record<string, string> {
  const plans = usePlansRaw();
  return useMemo(() => Object.fromEntries(plans.map((plan) => [plan.id, planTitle(plan)])), [plans]);
}

/**
 * Plans waiting on the reader: a batch to review, or new notes nobody has
 * written questions for. The Build tab's badge.
 */
export function useAttentionCount(): number {
  const plans = usePlansRaw();
  const catalog = useCatalog();
  return useMemo(() => {
    let count = 0;
    for (const plan of plans) {
      const open = openBatch(plan);
      if (open?.status === 'review') {
        count += 1;
        continue;
      }
      if (open || !plan.accepted || plan.baselinedAt === undefined || !catalog.complete) continue;
      if (freshNotes(resolveScope(catalog.notes, plan.accepted.scope), plan.seen, plan.coverage).length > 0) {
        count += 1;
      }
    }
    return count;
  }, [plans, catalog.notes, catalog.complete]);
}
