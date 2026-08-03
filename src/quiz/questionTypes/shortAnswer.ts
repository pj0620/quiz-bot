import { outcomeFromSelfGrade, type Grade, type ShortAnswerAnswer, type ShortAnswerQuestion } from '../types';
import { hasValidQuestionBase, normalizeAnswerText, type QuestionTypeLogic } from './contract';

export const shortAnswerLogic: QuestionTypeLogic<ShortAnswerQuestion> = {
  format: 'short-answer',
  label: 'Short answer',
  icon: 'create-outline',

  /**
   * Four-step grading, most authoritative first:
   *   1. The user's own verdict, if they gave one. They can always overrule.
   *   2. The model's verdict, when one was reached — see `gradeShortAnswer`.
   *   3. An exact hit against `acceptable`, which needs no network call.
   *   4. Otherwise hand back to the user with the model answer.
   *
   * The user outranks the model on purpose. The model is tolerant but not
   * infallible, and someone who knows they got it right must not be stuck with
   * a wrong verdict damaging their schedule.
   *
   * Note a *miss* against `acceptable` is NOT scored incorrect — exact text
   * matching is not good enough to fail someone on. It falls through, so the
   * list can only ever help, never punish.
   */
  grade(question, answer): Grade {
    if (answer.selfGrade) {
      const outcome = outcomeFromSelfGrade(answer.selfGrade);
      return { status: 'graded', outcome, score: outcome === 'correct' ? 1 : outcome === 'partial' ? 0.5 : 0 };
    }

    if (answer.judged) {
      const { outcome } = answer.judged;
      return { status: 'graded', outcome, score: outcome === 'correct' ? 1 : outcome === 'partial' ? 0.5 : 0 };
    }

    if (question.acceptable?.length) {
      const given = normalizeAnswerText(answer.text);
      const hit = question.acceptable.some((candidate) => normalizeAnswerText(candidate) === given);
      if (hit) return { status: 'graded', outcome: 'correct', score: 1 };
    }

    return { status: 'needs-self-grade', modelAnswer: question.modelAnswer, rubric: question.rubric };
  },

  isAnswerComplete(answer): boolean {
    return !!answer && answer.text.trim().length > 0;
  },

  isValid(value): value is ShortAnswerQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<ShortAnswerQuestion>;
    if (question.format !== 'short-answer') return false;
    if (typeof question.modelAnswer !== 'string' || !question.modelAnswer) return false;
    if (question.acceptable !== undefined) {
      if (!Array.isArray(question.acceptable)) return false;
      if (!question.acceptable.every((entry) => typeof entry === 'string')) return false;
    }
    if (question.rubric !== undefined) {
      if (!Array.isArray(question.rubric)) return false;
      if (!question.rubric.every((entry) => typeof entry === 'string')) return false;
    }
    return true;
  },

  summarize(): string {
    return 'Written answer';
  },
};

export function shortAnswerAnswer(text: string, selfGrade?: ShortAnswerAnswer['selfGrade']): ShortAnswerAnswer {
  return { format: 'short-answer', text, selfGrade };
}
