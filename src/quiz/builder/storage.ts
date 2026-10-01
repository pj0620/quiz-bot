import {
  createDebouncedSaver,
  loadAsync,
  loadSyncChecked,
  type HydrationResult,
  type PersistConfig,
} from '../../lib/persist';
import { isValidPlan, normalizePlan, type QuizPlan } from './types';

/**
 * Persistence for quiz plans.
 *
 * The shared envelope helpers, and the CHECKED hydration the quiz stores use,
 * rather than the raw read the coverage ledger gets away with. A plan is
 * content the reader wrote — a conversation, a plan they agreed, drafts they
 * have half reviewed — so it gets the same protection as their statistics: a
 * failed cold-launch read is recovered, never mistaken for "no plans" and then
 * persisted over the real ones.
 */
export const PLANS_KEY = 'quizbot.plans.v1';

export const plansConfig: PersistConfig<QuizPlan> = {
  key: PLANS_KEY,
  version: 1,
  isValid: isValidPlan,
};

/** Every row is repaired after validation — see `normalizePlan`. */
export function loadPlansSync(): HydrationResult<QuizPlan> {
  const result = loadSyncChecked(plansConfig);
  return { items: result.items.map(normalizePlan), failed: result.failed };
}

export async function loadPlansAsync(): Promise<QuizPlan[] | null> {
  const plans = await loadAsync(plansConfig);
  return plans === null ? null : plans.map(normalizePlan);
}

export const plansSaver = createDebouncedSaver(plansConfig);
