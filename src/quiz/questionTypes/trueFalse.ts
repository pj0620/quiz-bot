import type { Grade, TrueFalseAnswer, TrueFalseQuestion } from '../types';
import { hasValidQuestionBase, type AnswerTranscript, type QuestionTypeLogic } from './contract';

export const trueFalseLogic: QuestionTypeLogic<TrueFalseQuestion> = {
  format: 'true-false',
  label: 'True or false',
  icon: 'checkmark-circle-outline',

  grade(question, answer): Grade {
    const correct = answer.value === question.correct;
    return { status: 'graded', outcome: correct ? 'correct' : 'incorrect', score: correct ? 1 : 0 };
  },

  isAnswerComplete(answer): boolean {
    // Explicit null check: `false` is a complete answer, so truthiness is wrong here.
    return answer !== null && typeof answer.value === 'boolean';
  },

  isValid(value): value is TrueFalseQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<TrueFalseQuestion>;
    return question.format === 'true-false' && typeof question.correct === 'boolean';
  },

  summarize(): string {
    return 'True or false';
  },

  transcribe(question, answer): AnswerTranscript {
    return {
      // Explicit null check again: `false` is an answer, not a missing one.
      given: answer ? label(answer.value) : undefined,
      expected: label(question.correct),
    };
  },
};

function label(value: boolean): string {
  return value ? 'True' : 'False';
}

export function trueFalseAnswer(value: boolean): TrueFalseAnswer {
  return { format: 'true-false', value };
}
