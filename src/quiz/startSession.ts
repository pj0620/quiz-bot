import { hashString } from '../lib/random';
import { listCalendarQuestions } from './calendar/catalog';
import { getEnabledCalendarSubjects } from './calendar/preferences';
import { CALENDAR_SUBJECTS } from './calendar/types';
import { listGeographyQuestions } from './geography/catalog';
import { getEnabledSubjects } from './geography/preferences';
import { GEOGRAPHY_SUBJECTS } from './geography/types';
import { getSelectionMode } from './preferences';
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

/**
 * The bank plus whatever derived material is switched on — geography and
 * calendar subjects both.
 *
 * Unioned HERE rather than inside `selectQuestions`, which stays pure: the
 * engine takes a bank and a rule and knows nothing about where either came
 * from, and its tests can go on pinning an exact bank without a preferences
 * store in scope.
 *
 * `seed` and `now` must be the values the session will be created with, or the
 * questions selected here cannot be re-derived when the session is resumed.
 */
function bankWithDerived(seed: number, now: number): Question[] {
  const geographySubjects = getEnabledSubjects();
  const calendarSubjects = getEnabledCalendarSubjects();
  return [
    ...getQuestions(),
    ...listGeographyQuestions(geographySubjects, seed, now),
    ...listCalendarQuestions(calendarSubjects, seed, now),
  ];
}

export function startQuizSession(quiz: Quiz, now = Date.now()): StartResult | null {
  const reviewStates = getReviewStates();
  /*
    One seed for both jobs, and it has to be the one `createSession` will store.

    It computes `hashString(quizId:now)` from the same quiz and the same `now`,
    so this is that value — which is what lets `resolveSessionGeography` rebuild
    these exact questions later from the session alone.
  */
  const seed = hashString(`${quiz.id}:${now}`);
  const bank = bankWithDerived(seed, now);

  const { questions, shortfall } = selectQuestions({
    bank,
    reviewStates,
    rule: quiz.rule,
    now,
    seed,
    // Read here rather than defaulted inside the engine, so `selectQuestions`
    // stays pure and its tests can pin either mode without touching a store.
    mode: getSelectionMode(),
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

  /*
    Geography and calendar ids resolve through their catalogs, not the bank —
    there is nothing in the bank to find. Derived with the seed `createSession`
    is about to store (`adhoc:now`, since these sessions have no quiz), so
    "review what I missed" over a derived question rebuilds it exactly as the
    session will resolve it afterwards.

    Every subject is offered to the lookup regardless of the preference: these
    ids came from a session the reader has already sat, and switching a subject
    off should not make their own missed questions unreviewable.
  */
  const seed = hashString(`adhoc:${now}`);
  const derived = new Map(
    [
      ...listGeographyQuestions(GEOGRAPHY_SUBJECTS, seed, now),
      ...listCalendarQuestions(CALENDAR_SUBJECTS, seed, now),
    ].map((question) => [question.id, question]),
  );

  const questions = questionIds
    .map((id) => getQuestionById(id) ?? derived.get(id))
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
