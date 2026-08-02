import { useMemo, useSyncExternalStore } from 'react';

import { bankStore, quizzesStore, reviewStore, sessionsStore } from './store';
import { bankSummary, topicMastery, type TopicMastery } from './srs/mastery';
import { describeAvailability } from './selection/select';
import { topicVocabulary, type TopicCount } from './topics';
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

export function useBankSummary(now: number): ReturnType<typeof bankSummary> {
  const questions = useQuestions();
  const states = useReviewStates();
  return useMemo(() => bankSummary(questions, states, now), [questions, states, now]);
}

export function useTopicMastery(): TopicMastery[] {
  const questions = useQuestions();
  const states = useReviewStates();
  return useMemo(() => topicMastery(questions, states), [questions, states]);
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
