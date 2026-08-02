import type { Grade, MultipleChoiceAnswer, MultipleChoiceQuestion } from '../types';
import { hasValidQuestionBase, type QuestionTypeLogic } from './contract';

export const multipleChoiceLogic: QuestionTypeLogic<MultipleChoiceQuestion> = {
  format: 'multiple-choice',
  label: 'Multiple choice',
  icon: 'list-outline',

  grade(question, answer): Grade {
    // Graded by choice id, never index — the player shuffles choices, so index
    // comparison would mark correct answers wrong.
    const correct = answer.choiceId === question.correctChoiceId;
    return { status: 'graded', outcome: correct ? 'correct' : 'incorrect', score: correct ? 1 : 0 };
  },

  isAnswerComplete(answer): boolean {
    return !!answer?.choiceId;
  },

  isValid(value): value is MultipleChoiceQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<MultipleChoiceQuestion>;
    if (question.format !== 'multiple-choice') return false;
    if (!Array.isArray(question.choices)) return false;
    if (question.choices.length < 2 || question.choices.length > 6) return false;

    const ids = new Set<string>();
    for (const choice of question.choices) {
      if (!choice || typeof choice !== 'object') return false;
      if (typeof choice.id !== 'string' || !choice.id) return false;
      if (typeof choice.text !== 'string' || !choice.text) return false;
      if (ids.has(choice.id)) return false; // duplicate ids make grading ambiguous
      ids.add(choice.id);
    }

    // A real generator bug class: the correct answer not being among the
    // choices produces a question that is impossible to answer correctly.
    return typeof question.correctChoiceId === 'string' && ids.has(question.correctChoiceId);
  },

  summarize(question): string {
    return `${question.choices.length} choices`;
  },
};

export function multipleChoiceAnswer(choiceId: string): MultipleChoiceAnswer {
  return { format: 'multiple-choice', choiceId };
}
