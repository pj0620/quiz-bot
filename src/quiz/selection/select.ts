import { seededShuffle } from '../../lib/random';
import { daysUntilDue, isDue, isLeech, isNew } from '../srs/schedule';
import type { Question, QuizRule, ReviewState } from '../types';
import { matchesRule } from './matchesRule';

/**
 * The pure engine that turns a saved rule into an actual list of questions.
 *
 * This is what makes "a quiz is a rule, not a fixed list" real: nothing is
 * stored per quiz except the filter, and every session re-runs this against the
 * current bank — so newly generated questions appear automatically.
 *
 * Deterministic given the same seed, which matters for resumed sessions: a
 * session that reshuffled its own questions on relaunch would be maddening.
 */

export type SelectionInput = {
  bank: readonly Question[];
  reviewStates: Readonly<Record<string, ReviewState>>;
  rule: QuizRule;
  now: number;
  seed: number;
  /** Question ids to leave out — used by "review what I missed". */
  exclude?: readonly string[];
};

export type SelectionResult = {
  questions: Question[];
  /**
   * How many short of `rule.size` we came. Reported, never padded — the UI
   * decides whether to say "Start · 4 questions" or warn. Silently filling the
   * gap with off-rule questions would break the user's mental model.
   */
  shortfall: number;
  counts: { new: number; due: number; total: number };
};

/** Proportion of a session given to unseen questions, per mix. */
const NEW_RATIO: Record<QuizRule['mix'], number> = {
  balanced: 0.5,
  'new-only': 1,
  'review-only': 0,
};

export function selectQuestions(input: SelectionInput): SelectionResult {
  const { bank, reviewStates, rule, now, seed, exclude } = input;
  const excluded = exclude?.length ? new Set(exclude) : null;

  const newPool: Question[] = [];
  const duePool: Question[] = [];

  for (const question of bank) {
    if (excluded?.has(question.id)) continue;

    const state = reviewStates[question.id];
    if (!matchesRule(question, rule, state, now)) continue;

    // A leech is a question that keeps being failed. Excluding it stops one
    // impossible question from filling every session forever.
    if (isLeech(state)) continue;

    if (isNew(state)) {
      newPool.push(question);
    } else if (isDue(state, now)) {
      duePool.push(question);
    }
    // Not-yet-due questions are deliberately dropped: showing something a day
    // after you got it right is exactly what spaced repetition exists to avoid.
  }

  const size = Math.max(0, Math.floor(rule.size));
  const ratio = NEW_RATIO[rule.mix];

  // Due questions first, most overdue first. Ordering happens before the take
  // so the most overdue survive the cut, not a random sample of due items.
  const sortedDue = duePool
    .slice()
    .sort((a, b) => daysUntilDue(reviewStates[a.id], now) - daysUntilDue(reviewStates[b.id], now));

  // New questions shuffled: there's no meaningful priority among unseen items,
  // and bank order would otherwise march through one file at a time.
  const shuffledNew = seededShuffle(newPool, seed);

  let wantNew = Math.round(size * ratio);
  let wantDue = size - wantNew;

  // Rebalance when a pool can't fill its share. Without this, "balanced" on a
  // fresh install (zero due questions) would return 5 of a requested 10.
  if (shuffledNew.length < wantNew) {
    wantDue += wantNew - shuffledNew.length;
    wantNew = shuffledNew.length;
  }
  if (sortedDue.length < wantDue) {
    const deficit = wantDue - sortedDue.length;
    wantDue = sortedDue.length;
    wantNew = Math.min(shuffledNew.length, wantNew + deficit);
  }

  const chosenNew = shuffledNew.slice(0, wantNew);
  const chosenDue = sortedDue.slice(0, wantDue);

  // Interleave rather than front-loading all reviews: a session that opens with
  // ten reviews before any new material feels like a chore.
  const questions = seededShuffle([...chosenDue, ...chosenNew], seed ^ 0x5f37);

  return {
    questions,
    shortfall: Math.max(0, size - questions.length),
    counts: { new: chosenNew.length, due: chosenDue.length, total: questions.length },
  };
}

/**
 * What a rule *could* draw on right now, ignoring size.
 *
 * Feeds the "142 questions match · 12 due" line on quiz detail, so the user can
 * see the pool rather than inferring it from one session.
 */
export function describeAvailability(
  input: Omit<SelectionInput, 'seed'>,
): { matching: number; new: number; due: number; notYetDue: number; leeches: number } {
  const { bank, reviewStates, rule, now, exclude } = input;
  const excluded = exclude?.length ? new Set(exclude) : null;

  let matching = 0;
  let newCount = 0;
  let due = 0;
  let notYetDue = 0;
  let leeches = 0;

  for (const question of bank) {
    if (excluded?.has(question.id)) continue;
    const state = reviewStates[question.id];
    if (!matchesRule(question, rule, state, now)) continue;

    matching += 1;
    if (isLeech(state)) leeches += 1;
    else if (isNew(state)) newCount += 1;
    else if (isDue(state, now)) due += 1;
    else notYetDue += 1;
  }

  return { matching, new: newCount, due, notYetDue, leeches };
}
