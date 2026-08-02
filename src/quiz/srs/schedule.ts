import { addDays, daysBetween, startOfDay } from '../../lib/day';
import { hashString, createRandom } from '../../lib/random';
import type { Outcome, ReviewState } from '../types';

/**
 * SM-2 lite.
 *
 * A fixed interval ladder was the alternative, and it's simpler — but it can't
 * tell "wrong twice" from "wrong ten times", so a genuinely hard question and a
 * momentarily-forgotten one get identical treatment forever. A per-question
 * ease factor is the cheap fix for that, and it's the one part of SM-2 worth
 * keeping.
 *
 * Pure module: no I/O, no clock, no randomness that isn't seeded. Every
 * function takes `now` explicitly so the tests can pin time.
 */

export const SRS = {
  /** SM-2's default ease. */
  initialEase: 2.5,
  minEase: 1.3,
  maxEase: 3.0,

  /** Ease adjustments per outcome. */
  easeOnCorrect: 0.1,
  easeOnPartial: -0.15,
  easeOnIncorrect: -0.2,

  /** First two intervals are fixed; ease only starts multiplying afterwards. */
  firstIntervalDays: 1,
  secondIntervalDays: 3,

  /** A lapse doesn't reset to zero — you haven't forgotten it completely. */
  lapseIntervalDays: 1,
  /** Partial credit keeps some ground rather than restarting. */
  partialIntervalFactor: 0.5,

  /** Beyond six months, re-testing stops being informative. */
  maxIntervalDays: 180,

  /** Lapses at or above this mark a question a leech. */
  leechThreshold: 5,

  /** ±this fraction of the interval, seeded per question, to avoid pile-ups. */
  fuzzFactor: 0.1,
} as const;

function clampEase(ease: number): number {
  return Math.min(SRS.maxEase, Math.max(SRS.minEase, ease));
}

function easeDelta(outcome: Outcome): number {
  switch (outcome) {
    case 'correct':
      return SRS.easeOnCorrect;
    case 'partial':
      return SRS.easeOnPartial;
    case 'incorrect':
      return SRS.easeOnIncorrect;
  }
}

/**
 * Deterministic jitter, seeded from the question id.
 *
 * Without it, everything answered in one session comes due in the same session
 * forever, and the user faces a 40-question day followed by nothing. Seeded
 * rather than random so a given question's schedule is reproducible in tests.
 */
function fuzzInterval(days: number, questionId: string): number {
  if (days <= 1) return days;
  const random = createRandom(hashString(questionId));
  const spread = days * SRS.fuzzFactor;
  const offset = (random() * 2 - 1) * spread;
  return Math.max(1, days + offset);
}

function nextInterval(state: ReviewState | undefined, outcome: Outcome, ease: number): number {
  if (outcome === 'incorrect') return SRS.lapseIntervalDays;

  const reps = state?.reps ?? 0;
  if (reps === 0) return SRS.firstIntervalDays;
  if (reps === 1) return SRS.secondIntervalDays;

  const previous = state?.intervalDays ?? SRS.firstIntervalDays;
  const grown = previous * ease;
  const scaled = outcome === 'partial' ? grown * SRS.partialIntervalFactor : grown;
  return Math.min(SRS.maxIntervalDays, Math.max(SRS.firstIntervalDays, scaled));
}

/**
 * Folds one answer into a question's review state.
 *
 * `undefined` state means the question has never been answered, which is how a
 * brand-new question enters the system — there is no separate "create" call.
 */
export function recordReview(
  state: ReviewState | undefined,
  questionId: string,
  outcome: Outcome,
  now: number,
): ReviewState {
  const ease = clampEase((state?.ease ?? SRS.initialEase) + easeDelta(outcome));
  const rawInterval = nextInterval(state, outcome, ease);
  const intervalDays = fuzzInterval(rawInterval, questionId);
  const lapses = (state?.lapses ?? 0) + (outcome === 'incorrect' ? 1 : 0);

  return {
    questionId,
    ease,
    intervalDays,
    // Due dates land on calendar-day boundaries so "due today" means the whole
    // day, not "due at 14:32".
    dueAt: startOfDay(addDays(now, Math.round(intervalDays))),
    streak: outcome === 'correct' ? (state?.streak ?? 0) + 1 : 0,
    lapses,
    reps: (state?.reps ?? 0) + 1,
    lastReviewedAt: now,
    lastOutcome: outcome,
    leech: lapses >= SRS.leechThreshold ? true : undefined,
  };
}

/** A question never answered is new. */
export function isNew(state: ReviewState | undefined): state is undefined {
  return state === undefined;
}

/** Due when its due date has arrived. New questions are not "due" — they're new. */
export function isDue(state: ReviewState | undefined, now: number): boolean {
  if (!state) return false;
  return now >= state.dueAt;
}

/** Excluded from normal selection so one impossible question can't dominate. */
export function isLeech(state: ReviewState | undefined): boolean {
  return state?.leech === true;
}

/** Negative when overdue. Used for due-first ordering. */
export function daysUntilDue(state: ReviewState | undefined, now: number): number {
  if (!state) return Number.POSITIVE_INFINITY;
  return daysBetween(now, state.dueAt);
}

/** Validator for persistence. */
export function isValidReviewState(value: unknown): value is ReviewState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ReviewState>;
  return (
    typeof state.questionId === 'string' &&
    state.questionId.length > 0 &&
    typeof state.ease === 'number' &&
    Number.isFinite(state.ease) &&
    typeof state.intervalDays === 'number' &&
    Number.isFinite(state.intervalDays) &&
    typeof state.dueAt === 'number' &&
    typeof state.streak === 'number' &&
    typeof state.lapses === 'number' &&
    typeof state.reps === 'number' &&
    typeof state.lastReviewedAt === 'number'
  );
}
