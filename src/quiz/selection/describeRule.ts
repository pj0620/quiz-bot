import { formatTopic } from '../topics';
import { MASTERY_LABELS } from '../srs/mastery';
import { getQuestionLogic } from '../questionTypes/registry';
import type { QuizRule } from '../types';

/**
 * Renders a rule as human copy for quiz rows and detail headers.
 *
 * The user never sees the rule object, so this string is their entire mental
 * model of what a quiz contains — it needs to be accurate and short.
 */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function describeRule(rule: QuizRule, sourceNames?: Record<string, string>): string {
  // Each part is cased correctly at the point it's built rather than the whole
  // string being capitalized at the end — that would turn a repo name like
  // "octocat/hello" into "Octocat/hello".
  const parts: string[] = [];

  if (rule.addedWithinDays !== undefined) {
    parts.push(rule.addedWithinDays === 1 ? 'Added today' : `Added in the last ${rule.addedWithinDays} days`);
  }

  if (rule.topics?.length) {
    const names = rule.topics.map(formatTopic);
    parts.push(names.length <= 2 ? names.join(' or ') : `${names.length} topics`);
  }

  if (rule.sourceIds?.length) {
    // Source names are proper nouns (repo slugs) — never re-case them.
    const names = rule.sourceIds.map((id) => sourceNames?.[id] ?? 'A source');
    parts.push(names.length === 1 ? names[0] : `${names.length} sources`);
  }

  if (rule.formats?.length) {
    const names = rule.formats.map((format) => getQuestionLogic(format).label);
    parts.push(names.length === 1 ? names[0] : `${names.length} formats`);
  }

  if (rule.difficulties?.length) {
    parts.push(capitalize(rule.difficulties.join(' / ')));
  }

  if (rule.maxMastery !== undefined) {
    parts.push(`${MASTERY_LABELS[rule.maxMastery]} or weaker`);
  }

  if (rule.mix === 'new-only') parts.push('New only');
  if (rule.mix === 'review-only') parts.push('Reviews only');

  // No filters at all is a legitimate rule — it means the whole bank.
  if (parts.length === 0) return 'Everything in your bank';

  return parts.join(' · ');
}

/** Short label for how a session is composed. */
export function describeMix(rule: QuizRule): string {
  switch (rule.mix) {
    case 'new-only':
      return 'New material only';
    case 'review-only':
      return 'Reviews only';
    case 'balanced':
      return 'New and review';
  }
}

/**
 * The honest one-liner shown above the Start button.
 *
 * Stating the pool size and the draw size together is what keeps the live-rule
 * model from feeling like a bug the first time a user notices the questions
 * changed between attempts.
 */
export function describeDraw(rule: QuizRule, matching: number): string {
  if (matching === 0) return 'No questions match this quiz yet';
  if (matching <= rule.size) {
    // Noun and verb both have to agree: "1 question matches", "4 questions match".
    return matching === 1 ? '1 question matches right now' : `${matching} questions match right now`;
  }
  return `${matching} questions match right now — each attempt draws ${rule.size}`;
}
