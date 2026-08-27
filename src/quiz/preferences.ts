import { createStore } from '../lib/createStore';
import { readJsonSync, writeJson } from '../lib/kv';

/**
 * How a quiz decides which questions to draw.
 *
 * Split out from the LLM settings store on purpose: that one is about what
 * generation costs and which provider writes the questions, and this is about
 * what happens once they exist. They change for different reasons.
 */

const PREFERENCES_KEY = 'quizbot.quiz.preferences.v1';

/**
 * `spaced` is the app's own scheduling; `even` is a flat draw.
 *
 * The difference is not "shuffled or not" — both shuffle. It is WHICH questions
 * are eligible and whether some are more likely than others:
 *
 *  - `spaced` fills half a session with unseen questions and half with reviews
 *    that have come due, takes the most overdue first, and skips anything the
 *    schedule says is still resting. That is deliberate weighting, and it is
 *    what makes spaced repetition work.
 *  - `even` gives every question the rule matches the same chance, including
 *    ones answered correctly yesterday and ones repeatedly failed. Nothing is
 *    prioritised and nothing is held back.
 */
export type SelectionMode = 'spaced' | 'even';

export type QuizPreferences = {
  selectionMode: SelectionMode;
};

/**
 * Spaced by default, because it is the behaviour every existing install already
 * has and the one the review states were built up under. Switching is a
 * deliberate act, not something a version bump does to someone.
 */
const DEFAULTS: QuizPreferences = { selectionMode: 'spaced' };

function isSelectionMode(value: unknown): value is SelectionMode {
  return value === 'spaced' || value === 'even';
}

/** Tolerates a partial or stale stored value rather than discarding all of it. */
function loadSync(): QuizPreferences {
  const stored = readJsonSync<Partial<QuizPreferences>>(PREFERENCES_KEY);
  if (!stored) return DEFAULTS;
  return {
    selectionMode: isSelectionMode(stored.selectionMode)
      ? stored.selectionMode
      : DEFAULTS.selectionMode,
  };
}

export const preferencesStore = createStore<QuizPreferences>(loadSync());

export function setSelectionMode(selectionMode: SelectionMode): void {
  const next: QuizPreferences = { ...preferencesStore.get(), selectionMode };
  preferencesStore.set(next);
  // Fire-and-forget: a failed preference write must not break the screen.
  void writeJson(PREFERENCES_KEY, next).catch(() => undefined);
}

export function getSelectionMode(): SelectionMode {
  return preferencesStore.get().selectionMode;
}

/** React binding, kept beside the mutation API for a store this small. */
export function useSelectionMode(): SelectionMode {
  return preferencesStore.useSelector((state) => state.selectionMode);
}
