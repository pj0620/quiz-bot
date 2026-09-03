import { useMemo, useSyncExternalStore } from 'react';

import { listCalendarQuestions } from './calendar/catalog';
import { useEnabledCalendarSubjects } from './calendar/preferences';
import { resolveSessionCalendar } from './calendar/resolve';
import { listGeographyQuestions } from './geography/catalog';
import { useEnabledSubjects } from './geography/preferences';
import { resolveSessionGeography } from './geography/resolve';
import { bankStore, quizzesStore, reviewStore, sessionsStore } from './store';
import { describeAvailability } from './selection/select';
import { topicVocabulary, type TopicCount } from './topics';
import { summarizeTopics, type TopicSummary } from './topicStats';
import type { Question, Quiz, QuizRule, ReviewState, Session } from './types';

/**
 * React bindings.
 *
 * These call `useSyncExternalStore` directly rather than `store.useSelector`
 * so they can return the SAME array/object reference between renders — a
 * selector returning a fresh array would fail the Object.is snapshot check and
 * loop forever. Derived values that must allocate go through `useMemo` instead.
 */

export function useQuestions(): Question[] {
  return useSyncExternalStore(
    bankStore.subscribe,
    () => bankStore.get().questions,
    () => bankStore.get().questions,
  );
}

export function useReviewStates(): Record<string, ReviewState> {
  return useSyncExternalStore(
    reviewStore.subscribe,
    () => reviewStore.get().states,
    () => reviewStore.get().states,
  );
}

export function useQuizzes(): Quiz[] {
  return useSyncExternalStore(
    quizzesStore.subscribe,
    () => quizzesStore.get().quizzes,
    () => quizzesStore.get().quizzes,
  );
}

export function useSessions(): Session[] {
  return useSyncExternalStore(
    sessionsStore.subscribe,
    () => sessionsStore.get().sessions,
    () => sessionsStore.get().sessions,
  );
}

export function useQuestion(id: string | undefined): Question | undefined {
  const questions = useQuestions();
  return useMemo(() => (id ? questions.find((question) => question.id === id) : undefined), [questions, id]);
}

export function useQuiz(id: string | undefined): Quiz | undefined {
  const quizzes = useQuizzes();
  return useMemo(() => (id ? quizzes.find((quiz) => quiz.id === id) : undefined), [quizzes, id]);
}

export function useSession(id: string | undefined): Session | undefined {
  const sessions = useSessions();
  return useMemo(() => (id ? sessions.find((session) => session.id === id) : undefined), [sessions, id]);
}

export function useActiveSession(): Session | undefined {
  const sessions = useSessions();
  return useMemo(() => sessions.find((session) => session.status === 'active'), [sessions]);
}

/**
 * Every question a session refers to, from wherever it actually lives.
 *
 * The player and the results screen both resolve `item.questionId` through the
 * bank, which is correct for everything the bank holds and silently wrong for
 * geography — those questions are derived, never stored, so a bank lookup finds
 * nothing and the screen renders empty.
 *
 * Re-derived from the session's OWN `seed` and `startedAt`, both persisted, so
 * a session resumed days later rebuilds the same questions with the same
 * options — and the grade stored against them still describes what the reader
 * actually saw.
 */
export function useSessionQuestions(session: Session | undefined): Map<string, Question> {
  const questions = useQuestions();

  return useMemo(() => {
    const byId = new Map(questions.map((question) => [question.id, question]));
    if (!session) return byId;
    // Bank first, derived second: a stored row wins, so nothing here can
    // shadow a real question that happens to share an id.
    for (const question of resolveSessionGeography(session)) {
      if (!byId.has(question.id)) byId.set(question.id, question);
    }
    for (const question of resolveSessionCalendar(session)) {
      if (!byId.has(question.id)) byId.set(question.id, question);
    }
    return byId;
  }, [questions, session]);
}

/**
 * Everything a quiz rule can currently draw on: the bank PLUS whatever
 * geography is switched on.
 *
 * Distinct from `useQuestions`, and the distinction is the point. The bank is
 * what the reader OWNS — it is what the library counts, what the browser lists,
 * and what "clear the question bank" empties. This is what a quiz can ASK,
 * which since geography became derived is a strictly larger set.
 *
 * Anything that decides whether a quiz has something to offer must use this
 * one. Counting the bank instead is not a small error: it reports zero matches
 * for a geography quiz that is perfectly able to run, and the screen then
 * disables its own Start button.
 */
export function useSelectableQuestions(): Question[] {
  const questions = useQuestions();
  const subjects = useEnabledSubjects();
  const calendarSubjects = useEnabledCalendarSubjects();

  return useMemo(() => {
    if (subjects.length === 0 && calendarSubjects.length === 0) return questions;
    /*
      The seed is fixed because nothing here looks at what varies with it.
      Seeding changes which distractors a multiple-choice question offers; ids,
      topics, formats and difficulties — everything a rule filters or a count
      counts — are identical for every seed. The real seed is chosen when a
      session is actually created, in `startQuizSession`.
    */
    return [
      ...questions,
      ...listGeographyQuestions(subjects, COUNTING_SEED, Date.now()),
      ...listCalendarQuestions(calendarSubjects, COUNTING_SEED, Date.now()),
    ];
  }, [questions, subjects, calendarSubjects]);
}

/** See `useSelectableQuestions` for why any seed does. */
const COUNTING_SEED = 0;

/**
 * The topics a quiz rule may be built from.
 *
 * Separate from `useTopicVocabulary`, which stays bank-only on purpose: the
 * bank browser filters ROWS IT CAN SHOW, and offering it a topic with no stored
 * questions behind it would filter the list down to nothing.
 */
export function useSelectableTopicVocabulary(): TopicCount[] {
  const questions = useSelectableQuestions();
  return useMemo(() => topicVocabulary(questions), [questions]);
}

/**
 * Every topic with its mastery, grade and due count, weakest first — what the
 * Stats tab's topic rows and the "By topic" screen are built from.
 *
 * Selectable rather than the bank: review states are kept for geography and
 * the calendar just as they are for anything else, and progress the reader has
 * actually made should show up next to the rest of it.
 */
export function useTopicSummaries(now: number): TopicSummary[] {
  const questions = useSelectableQuestions();
  const states = useReviewStates();
  const sessions = useSessions();
  return useMemo(
    () => summarizeTopics({ questions, reviewStates: states, sessions, now }),
    [questions, states, sessions, now],
  );
}

/**
 * The topics the quiz editor may offer.
 *
 * Restricting the editor to this list is what prevents a user creating a quiz
 * that matches nothing because they typed a topic the bank has never seen.
 */
export function useTopicVocabulary(): TopicCount[] {
  const questions = useQuestions();
  return useMemo(() => topicVocabulary(questions), [questions]);
}

/** Live counts behind "142 questions match right now". */
export function useRuleAvailability(rule: QuizRule, now: number) {
  const questions = useQuestions();
  const states = useReviewStates();
  return useMemo(
    () => describeAvailability({ bank: questions, reviewStates: states, rule, now }),
    [questions, states, rule, now],
  );
}
