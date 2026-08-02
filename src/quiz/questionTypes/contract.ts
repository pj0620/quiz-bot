import type { ComponentProps, ComponentType } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { AnswerFor, Grade, Question, QuestionFormat } from '../types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Everything about a question format EXCEPT how it renders.
 *
 * Kept free of React on purpose: grading is the part worth testing hardest, and
 * a pure module means those tests need no renderer, no mocks, and no native
 * modules. Views are registered separately in `views.tsx`.
 */
export type QuestionTypeLogic<Q extends Question = Question> = {
  format: Q['format'];
  /** Shown as a chip in the player and as a filter in the bank browser. */
  label: string;
  icon: IoniconName;

  /**
   * Grades an answer. May return `{ status: 'needs-self-grade' }`, which is how
   * self-assessed formats coexist with auto-graded ones behind one interface —
   * the player switches its action bar rather than showing a verdict.
   */
  grade(question: Q, answer: AnswerFor<Q>): Grade;

  /** Whether the Check button should be enabled. */
  isAnswerComplete(answer: AnswerFor<Q> | null): boolean;

  /** Storage validation. A row failing this is dropped without losing the batch. */
  isValid(value: unknown): value is Q;

  /** One-line description for list rows and results. */
  summarize(question: Q): string;
};

export type AnswerViewProps<Q extends Question = Question> = {
  question: Q;
  answer: AnswerFor<Q> | null;
  onChange: (answer: AnswerFor<Q>) => void;
  /** Null before the user checks; set afterwards, which reveals correctness. */
  grade: Grade | null;
  /** True after reveal, and on the read-only question-detail screen. */
  disabled?: boolean;
  /** Stable per-session, so choice order doesn't change on re-render. */
  shuffleSeed?: number;
};

export type AnswerView<Q extends Question = Question> = ComponentType<AnswerViewProps<Q>>;

/** Logic plus view — what screens actually consume, via `getQuestionType`. */
export type QuestionTypeDefinition<Q extends Question = Question> = QuestionTypeLogic<Q> & {
  AnswerView: AnswerView<Q>;
};

/** Narrows the union to the member matching a format. */
export type QuestionOf<K extends QuestionFormat> = Extract<Question, { format: K }>;

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/** Fields every question carries, checked before any format-specific test. */
export function hasValidQuestionBase(value: unknown): value is Question {
  if (!value || typeof value !== 'object') return false;
  const question = value as Partial<Question>;
  return (
    typeof question.id === 'string' &&
    question.id.length > 0 &&
    typeof question.prompt === 'string' &&
    question.prompt.length > 0 &&
    typeof question.explanation === 'string' &&
    Array.isArray(question.topics) &&
    question.topics.every((topic) => typeof topic === 'string') &&
    typeof question.sourceId === 'string' &&
    typeof question.addedAt === 'number' &&
    !!question.provenance &&
    typeof question.provenance === 'object'
  );
}

/**
 * Loose comparison for free-text answers: case, surrounding whitespace, and
 * trailing punctuation shouldn't decide correctness.
 */
export function normalizeAnswerText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '');
}
