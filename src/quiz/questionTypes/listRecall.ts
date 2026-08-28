import type { Grade, ListRecallAnswer, ListRecallQuestion } from '../types';
import {
  bulleted,
  hasValidQuestionBase,
  normalizeAnswerText,
  type AnswerTranscript,
  type QuestionTypeLogic,
} from './contract';

/**
 * Below this length a containment match is meaningless — "war" would match
 * "warfare", "postwar" and half the note besides.
 */
const MIN_CONTAINMENT_LENGTH = 4;

/**
 * Whether a typed entry counts as naming a list item.
 *
 * Deliberately forgiving in both directions. Someone recalling "Population"
 * from a note that reads "Population advantage" is not wrong, and neither is
 * someone who writes "the population ratio". Recall questions are for checking
 * whether you remember the material, and a grader that rewards guessing the
 * writer's exact phrasing tests something else entirely.
 */
export function entryMatchesItem(given: string, item: string): boolean {
  const a = normalizeAnswerText(given);
  const b = normalizeAnswerText(item);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < MIN_CONTAINMENT_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

export const listRecallLogic: QuestionTypeLogic<ListRecallQuestion> = {
  format: 'list-recall',
  label: 'Name them',
  icon: 'list-outline',

  /**
   * Scored against `required`, not against the full list, so "name three of the
   * five" is graded on the three that were asked for. Each item can only be
   * claimed once, or typing the same answer three times would score full marks.
   *
   * When the model judged the entries (`answer.judged`, see `gradeListRecall`),
   * its matches are ADDED to the string matcher's, never substituted for them.
   * The model exists to catch what string matching cannot — "the USSR" naming
   * "Soviet Union" — but an entry that literally matches the note must never
   * be failed by a flaky verdict. The judge can only help, never punish.
   */
  grade(question, answer): Grade {
    const claimed = new Set<number>();
    const parts: Record<string, boolean> = {};

    for (const entry of answer.entries) {
      if (!entry.trim()) continue;
      const index = question.items.findIndex(
        (item, position) => !claimed.has(position) && entryMatchesItem(entry, item),
      );
      if (index >= 0) {
        claimed.add(index);
        parts[String(index)] = true;
      }
    }

    if (answer.judged) {
      for (const index of answer.judged.matchedItems) {
        if (!Number.isInteger(index) || index < 0 || index >= question.items.length) continue;
        claimed.add(index);
        parts[String(index)] = true;
      }
    }

    const required = Math.max(1, Math.min(question.required, question.items.length));
    const score = Math.min(1, claimed.size / required);
    const outcome = score === 1 ? 'correct' : score === 0 ? 'incorrect' : 'partial';
    return { status: 'graded', outcome, score, parts };
  },

  /** One entry is enough to submit: partial recall is a real, gradeable answer. */
  isAnswerComplete(answer): boolean {
    return !!answer && answer.entries.some((entry) => entry.trim().length > 0);
  },

  isValid(value): value is ListRecallQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<ListRecallQuestion>;
    if (question.format !== 'list-recall') return false;
    if (!Array.isArray(question.items) || question.items.length < 2) return false;
    if (!question.items.every((item) => typeof item === 'string' && item.trim().length > 0)) return false;
    if (typeof question.required !== 'number' || !Number.isInteger(question.required)) return false;
    // Asking for more than the note lists is unanswerable, which is a generator
    // bug worth dropping the row over rather than showing to someone.
    if (question.required < 1 || question.required > question.items.length) return false;
    return true;
  },

  summarize(question): string {
    return `Name ${question.required} of ${question.items.length}`;
  },

  transcribe(question, answer): AnswerTranscript {
    const entries = answer?.entries.map((entry) => entry.trim()).filter(Boolean) ?? [];
    return {
      given: entries.length > 0 ? bulleted(entries) : undefined,
      // The WHOLE list, with the bar stated: "you needed 3 of these 4" is the
      // fact a reader needs to judge their own answer, and it is not in either
      // the prompt or the entries on their own.
      expected: `Any ${question.required} of:\n${bulleted(question.items)}`,
    };
  },
};

export function listRecallAnswer(entries: string[], judged?: ListRecallAnswer['judged']): ListRecallAnswer {
  return { format: 'list-recall', entries, judged };
}
