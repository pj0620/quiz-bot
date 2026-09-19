import {
  outcomeFromSelfGrade,
  type Grade,
  type JudgedGrade,
  type ShortAnswerAnswer,
  type ShortAnswerQuestion,
} from '../types';
import { matchAnswerLocally, type LocalMatch } from './answerMatch';
import {
  bulleted,
  hasValidQuestionBase,
  normalizeAnswerText,
  type AnswerTranscript,
  type QuestionTypeLogic,
} from './contract';

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

  transcribe(question, answer): AnswerTranscript {
    const text = answer?.text.trim();
    return {
      // The rubric, when there is one — it's the marking scheme, and it tells
      // whoever reads this what the answer was supposed to cover.
      detail: question.rubric?.length
        ? `A good answer covers:\n${bulleted(question.rubric)}`
        : undefined,
      given: text || undefined,
      expected: question.modelAnswer,
    };
  },
};

export function shortAnswerAnswer(text: string, selfGrade?: ShortAnswerAnswer['selfGrade']): ShortAnswerAnswer {
  return { format: 'short-answer', text, selfGrade };
}

/**
 * Marks a written answer on the device, or declines to.
 *
 * Runs BEFORE the model is asked, and is the reason most short answers never
 * need it: the answer is checked against the model answer and every
 * `acceptable` variant, ignoring case and punctuation, then allowing a
 * spelling slip, then allowing reordered words — see `answerMatch.ts` for the
 * three checks and the guards on them. None of this needs a connection, and
 * all of it is done before the Check button has finished being pressed.
 *
 * Only ever returns "correct". Null is not "incorrect", it is "cannot tell":
 * a paraphrase, a synonym, or a plainly wrong answer all look the same from
 * here, and telling them apart is what the model — or failing that, the
 * reader — is for.
 */
export function judgeShortAnswerLocally(question: ShortAnswerQuestion, text: string): JudgedGrade | null {
  const match = matchAnswerLocally(text, [question.modelAnswer, ...(question.acceptable ?? [])]);
  if (!match) return null;
  return { outcome: 'correct', reason: localReason(match) };
}

/** Shown above the explanation, in the place the model's reason would go. */
function localReason(match: LocalMatch): string {
  switch (match.via) {
    case 'exact':
      return 'That matches the answer.';
    case 'fuzzy':
      return 'That matches the answer, spelling aside.';
    case 'similar':
      return 'That matches the answer, wording aside.';
  }
}
