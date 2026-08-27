import type { ComponentProps, ComponentType } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { AnswerFor, Grade, Question, QuestionFigure, QuestionFormat } from '../types';

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

  /**
   * Whether the Check button should be enabled.
   *
   * Takes the question as well as the answer, because "complete" is a fact
   * about the two together: a timeline is complete when every event has been
   * placed, and a fill-blank when every blank has been filled. Neither is
   * answerable from the answer alone — the views only write a key once the
   * reader has touched it, so counting what is present tells you how much has
   * been typed, not how much is left.
   */
  isAnswerComplete(answer: AnswerFor<Q> | null, question: Q): boolean;

  /** Storage validation. A row failing this is dropped without losing the batch. */
  isValid(value: unknown): value is Q;

  /** One-line description for list rows and results. */
  summarize(question: Q): string;

  /**
   * The question and the answer as PLAIN TEXT, for a reader outside the app.
   *
   * Takes the pair for the same reason `grade` does: what the reader chose is
   * a choice id, a set of blank values, an order of event ids — none of which
   * mean anything without the question they belong to. Rendering it here rather
   * than in the summary builder keeps that dispatch on the registry, so a new
   * format cannot ship with a grader and a view but no way to be talked about.
   */
  transcribe(question: Q, answer: AnswerFor<Q> | null): AnswerTranscript;
};

/**
 * A question and an attempt at it, flattened to prose.
 *
 * Written for a chat window, not for the UI: nothing here is a label, an id or
 * an index, because whoever reads it has only this text and no access to the
 * question bank.
 */
export type AnswerTranscript = {
  /**
   * The body of the question beyond its prompt — the options to pick from, the
   * list to name, the sentence with its blanks. Absent when the prompt is the
   * whole question.
   */
  detail?: string;
  /** What the reader put. Absent when they gave up without answering. */
  given?: string;
  /** The right answer, spelled out. */
  expected: string;
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
    typeof question.provenance === 'object' &&
    hasValidFigure(question.figure)
  );
}

/**
 * Optional, so ABSENT is valid and only a malformed one fails.
 *
 * Checked at all because a figure the player cannot draw leaves a shape
 * question with no shape — the prompt says "which state is this?" above an
 * empty box, which is unanswerable rather than merely wrong. Failing here drops
 * that row on load and leaves the rest of the batch alone.
 */
function hasValidFigure(figure: unknown): boolean {
  if (figure === undefined) return true;
  if (!figure || typeof figure !== 'object') return false;
  const value = figure as Partial<QuestionFigure>;
  return (
    value.kind === 'region-shape' &&
    typeof value.mapId === 'string' &&
    typeof value.regionId === 'string' &&
    value.regionId.length > 0
  );
}

/** A bulleted block for `transcribe`. Empty in gives empty out, never a stray dash. */
export function bulleted(entries: string[]): string {
  return entries.map((entry) => `- ${entry}`).join('\n');
}

/** A numbered block for `transcribe`, where the ORDER is the answer. */
export function numbered(entries: string[]): string {
  return entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n');
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
