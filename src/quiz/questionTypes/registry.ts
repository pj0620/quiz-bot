import type { Answer, AnswerFor, Grade, Question, QuestionFormat } from '../types';
import type { QuestionOf, QuestionTypeLogic } from './contract';
import { fillBlankLogic } from './fillBlank';
import { listRecallLogic } from './listRecall';
import { multipleChoiceLogic } from './multipleChoice';
import { shortAnswerLogic } from './shortAnswer';
import { trueFalseLogic } from './trueFalse';

/**
 * The question-format registry.
 *
 * Mirrors `src/sources/registry.ts` exactly. The mapped type over
 * `QuestionFormat` (which is itself derived from the `Question` union) is the
 * whole mechanism: adding a member to the union without adding an entry here is
 * a COMPILE ERROR, so a format can never be half-wired.
 *
 * Adding a format is: a new member on `Question`, a new answer member, one
 * logic file, one line here, and one line in `views.tsx`.
 */
const QUESTION_TYPE_LOGIC: { [K in QuestionFormat]: QuestionTypeLogic<QuestionOf<K>> } = {
  'multiple-choice': multipleChoiceLogic,
  'true-false': trueFalseLogic,
  'short-answer': shortAnswerLogic,
  'list-recall': listRecallLogic,
  'fill-blank': fillBlankLogic,
};

export function getQuestionLogic(format: QuestionFormat): QuestionTypeLogic {
  return QUESTION_TYPE_LOGIC[format] as QuestionTypeLogic;
}

export function listQuestionFormats(): QuestionTypeLogic[] {
  return Object.values(QUESTION_TYPE_LOGIC) as QuestionTypeLogic[];
}

export function isKnownFormat(value: unknown): value is QuestionFormat {
  return typeof value === 'string' && value in QUESTION_TYPE_LOGIC;
}

// ---------------------------------------------------------------------------
// Dispatching helpers — the only places that need the unchecked cast
// ---------------------------------------------------------------------------

/**
 * Grades any question with its matching answer.
 *
 * The cast is safe but unavoidable: TypeScript can't see that `question` and
 * `answer` share a format at this call site, even though `AnswerFor<Q>` and the
 * registry's mapped type guarantee it. Confining the cast here keeps every
 * caller type-safe.
 */
export function gradeAnswer(question: Question, answer: Answer): Grade {
  const logic = getQuestionLogic(question.format) as QuestionTypeLogic<Question>;
  return logic.grade(question, answer as AnswerFor<Question>);
}

export function isAnswerComplete(question: Question, answer: Answer | null): boolean {
  const logic = getQuestionLogic(question.format) as QuestionTypeLogic<Question>;
  return logic.isAnswerComplete(answer as AnswerFor<Question> | null);
}

export function summarizeQuestion(question: Question): string {
  const logic = getQuestionLogic(question.format) as QuestionTypeLogic<Question>;
  return logic.summarize(question);
}

/**
 * Storage validation across all formats. Dispatches on `format` so an unknown
 * or malformed row is dropped individually rather than taking out the batch.
 */
export function isValidQuestion(value: unknown): value is Question {
  if (!value || typeof value !== 'object') return false;
  const format = (value as { format?: unknown }).format;
  if (!isKnownFormat(format)) return false;
  return getQuestionLogic(format).isValid(value);
}
