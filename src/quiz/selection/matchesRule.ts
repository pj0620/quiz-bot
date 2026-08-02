import { isWithinDays } from '../../lib/day';
import { isAtOrBelowMastery } from '../srs/mastery';
import type { Question, QuizRule, ReviewState } from '../types';

/**
 * Whether a question satisfies a rule's filters.
 *
 * Factored out of `select.ts` because the bank browser needs the same predicate
 * to show "142 questions match right now" without running a full selection —
 * and that count appearing on quiz detail is what stops the live-rule model
 * surprising the user.
 *
 * Note this covers FILTERS only. Size, mix, ordering, and due/new balancing all
 * live in `select.ts`; a question matching a rule doesn't mean it will appear in
 * the next session.
 */
export function matchesRule(
  question: Question,
  rule: QuizRule,
  reviewState: ReviewState | undefined,
  now: number,
): boolean {
  // Flagged questions are out of circulation everywhere, unconditionally. A
  // question the user has declared broken must never come back.
  if (question.flagged) return false;

  // ANY, not ALL. A question tagged [auth, tokens] should match a rule asking
  // for either — requiring all would make multi-topic rules match nothing.
  if (rule.topics?.length) {
    if (!question.topics.some((topic) => rule.topics?.includes(topic))) return false;
  }

  if (rule.sourceIds?.length && !rule.sourceIds.includes(question.sourceId)) return false;

  if (rule.formats?.length && !rule.formats.includes(question.format)) return false;

  if (rule.difficulties?.length && !rule.difficulties.includes(question.difficulty)) return false;

  // Uses addedAt (when it entered the local bank), not contentAt — "what's new
  // to me" is the useful question, not "what was committed recently".
  if (rule.addedWithinDays !== undefined) {
    if (!isWithinDays(question.addedAt, rule.addedWithinDays, now)) return false;
  }

  if (rule.maxMastery !== undefined) {
    if (!isAtOrBelowMastery(reviewState, rule.maxMastery)) return false;
  }

  return true;
}

/** How many questions a rule currently matches. Drives the live count in the UI. */
export function countMatching(
  bank: readonly Question[],
  rule: QuizRule,
  reviewStates: Readonly<Record<string, ReviewState>>,
  now: number,
): number {
  let count = 0;
  for (const question of bank) {
    if (matchesRule(question, rule, reviewStates[question.id], now)) count += 1;
  }
  return count;
}

export function filterMatching(
  bank: readonly Question[],
  rule: QuizRule,
  reviewStates: Readonly<Record<string, ReviewState>>,
  now: number,
): Question[] {
  return bank.filter((question) => matchesRule(question, rule, reviewStates[question.id], now));
}
