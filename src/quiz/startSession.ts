import { hashString } from '../lib/random';
import { isNew } from './srs/schedule';
import { selectQuestions } from './selection/select';
import { createSession, getQuestionById, getQuestions, getReviewStates } from './store';
import type { Question, Quiz, Session } from './types';

/**
 * The one place a session is created.
 *
 * Both entry points funnel through here so the "which questions" decision
 * always runs the same selection engine, and `wasNew` is always captured before
 * any answer mutates review state.
 */

export type StartResult = {
  session: Session;
  shortfall: number;
};

export function startQuizSession(quiz: Quiz, now = Date.now()): StartResult | null {
  const bank = getQuestions();
  const reviewStates = getReviewStates();
  const seed = hashString(`${quiz.id}:${now}`);

  const { questions, shortfall } = selectQuestions({
    bank,
    reviewStates,
    rule: quiz.rule,
    now,
    seed,
  });

  if (questions.length === 0) return null;

  const session = createSession({
    quizId: quiz.id,
    quizName: quiz.name,
    questions,
    newIds: newIdsFor(questions, reviewStates),
    now,
  });

  return { session, shortfall };
}

/** Ad-hoc sessions: "practice this now", "review what I missed". */
export function startAdhocSession(
  questionIds: readonly string[],
  name: string,
  now = Date.now(),
): StartResult | null {
  const reviewStates = getReviewStates();
  const questions = questionIds
    .map((id) => getQuestionById(id))
    .filter((question): question is Question => !!question && !question.flagged);

  if (questions.length === 0) return null;

  const session = createSession({
    quizName: name,
    questions,
    newIds: newIdsFor(questions, reviewStates),
    now,
  });

  return { session, shortfall: 0 };
}

function newIdsFor(
  questions: readonly Question[],
  reviewStates: Readonly<Record<string, unknown>>,
): Set<string> {
  const ids = new Set<string>();
  for (const question of questions) {
    if (isNew(reviewStates[question.id] as never)) ids.add(question.id);
  }
  return ids;
}
