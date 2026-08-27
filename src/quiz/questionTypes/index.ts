import type { Question, QuestionFormat } from '../types';
import type { AnswerView, QuestionTypeDefinition } from './contract';
import { getQuestionLogic } from './registry';
import { QUESTION_TYPE_VIEWS } from './views';

/**
 * Combines the logic and view registries into what screens consume.
 *
 * Split in two because grading must be testable without React, but they are
 * independently compile-checked against the same `QuestionFormat` union — a new
 * format can't ship with a grader but no renderer, or vice versa.
 */
export function getQuestionType(format: QuestionFormat): QuestionTypeDefinition {
  return {
    ...(getQuestionLogic(format) as QuestionTypeDefinition),
    AnswerView: QUESTION_TYPE_VIEWS[format] as AnswerView,
  };
}

export function getAnswerView(format: QuestionFormat): AnswerView {
  return QUESTION_TYPE_VIEWS[format] as AnswerView;
}

export function getQuestionTypeFor(question: Question): QuestionTypeDefinition {
  return getQuestionType(question.format);
}

export * from './contract';
export {
  gradeAnswer,
  getQuestionLogic,
  isAnswerComplete,
  isKnownFormat,
  isValidQuestion,
  listQuestionFormats,
  summarizeQuestion,
  transcribeAnswer,
} from './registry';
