import type { FillBlankAnswer, FillBlankQuestion, Grade } from '../types';
import { hasValidQuestionBase, normalizeAnswerText, type QuestionTypeLogic } from './contract';

/** Matches the {{blankId}} placeholders in a template. */
const PLACEHOLDER = /\{\{([a-zA-Z0-9_-]+)\}\}/g;

export type TemplateRun =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; blankId: string };

/**
 * Splits a template into alternating text and blank runs.
 *
 * The renderer needs this because a TextInput nested inside a Text is
 * unreliable in React Native — the layout has to be a wrapping row of separate
 * Text and TextInput elements instead.
 */
export function parseTemplate(template: string): TemplateRun[] {
  const runs: TemplateRun[] = [];
  let lastIndex = 0;

  // Fresh regex per call: PLACEHOLDER is global, so a shared lastIndex would
  // make consecutive calls return different results.
  const pattern = new RegExp(PLACEHOLDER.source, 'g');
  let match = pattern.exec(template);
  while (match !== null) {
    if (match.index > lastIndex) {
      runs.push({ kind: 'text', text: template.slice(lastIndex, match.index) });
    }
    runs.push({ kind: 'blank', blankId: match[1] });
    lastIndex = match.index + match[0].length;
    match = pattern.exec(template);
  }

  if (lastIndex < template.length) {
    runs.push({ kind: 'text', text: template.slice(lastIndex) });
  }
  return runs;
}

export const fillBlankLogic: QuestionTypeLogic<FillBlankQuestion> = {
  format: 'fill-blank',
  label: 'Fill in the blank',
  icon: 'text-outline',

  /** Partial credit: score is the fraction of blanks filled correctly. */
  grade(question, answer): Grade {
    const parts: Record<string, boolean> = {};
    let correctCount = 0;

    for (const blank of question.blanks) {
      const given = answer.values[blank.id] ?? '';
      const isCorrect = blank.caseSensitive
        ? blank.accepted.some((candidate) => candidate.trim() === given.trim())
        : blank.accepted.some((candidate) => normalizeAnswerText(candidate) === normalizeAnswerText(given));

      parts[blank.id] = isCorrect;
      if (isCorrect) correctCount += 1;
    }

    const total = question.blanks.length;
    const score = total === 0 ? 0 : correctCount / total;
    const outcome = score === 1 ? 'correct' : score === 0 ? 'incorrect' : 'partial';
    return { status: 'graded', outcome, score, parts };
  },

  /** Every blank must have something in it — a partial submission isn't ready. */
  isAnswerComplete(answer): boolean {
    if (!answer) return false;
    const values = Object.values(answer.values);
    return values.length > 0 && values.every((value) => value.trim().length > 0);
  },

  isValid(value): value is FillBlankQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<FillBlankQuestion>;
    if (question.format !== 'fill-blank') return false;
    if (typeof question.template !== 'string' || !question.template) return false;
    if (!Array.isArray(question.blanks) || question.blanks.length === 0) return false;

    const ids = new Set<string>();
    for (const blank of question.blanks) {
      if (!blank || typeof blank !== 'object') return false;
      if (typeof blank.id !== 'string' || !blank.id) return false;
      if (ids.has(blank.id)) return false;
      ids.add(blank.id);
      if (!Array.isArray(blank.accepted) || blank.accepted.length === 0) return false;
      if (!blank.accepted.every((entry) => typeof entry === 'string')) return false;
    }

    // Every placeholder must have a matching blank definition, and vice versa —
    // otherwise the renderer draws an input nothing can grade, or defines a
    // blank the user never sees.
    const placeholders = parseTemplate(question.template)
      .filter((run): run is Extract<TemplateRun, { kind: 'blank' }> => run.kind === 'blank')
      .map((run) => run.blankId);
    if (placeholders.length !== ids.size) return false;
    return placeholders.every((id) => ids.has(id));
  },

  summarize(question): string {
    const count = question.blanks.length;
    return `${count} blank${count === 1 ? '' : 's'}`;
  },
};

export function fillBlankAnswer(values: Record<string, string>): FillBlankAnswer {
  return { format: 'fill-blank', values };
}
