import {
  createDebouncedRecordSaver,
  createDebouncedSaver,
  loadAsync,
  loadRecordAsync,
  loadRecordSyncChecked,
  loadSyncChecked,
  type PersistConfig,
} from '../lib/persist';
import { isValidQuestion } from './questionTypes/registry';
import { isValidReviewState } from './srs/schedule';
import type { Question, Quiz, ReviewState, Session } from './types';

/**
 * Persistence config for the four quiz stores.
 *
 * Key convention matches the existing `quizbot.<domain>.v<N>`. All four use the
 * shared envelope helpers, so version mismatches discard rather than migrate and
 * one malformed row never takes out the batch.
 */

/*
  Bumped to v2 when generation moved from source files to markdown notes.

  Nothing in a v1 bank is worth carrying forward: the prompts describe code, the
  topics were slugified from whole filenames, and the ids came from a different
  scheme so re-generation would duplicate rather than dedupe. Review states and
  sessions are keyed by those ids, so they go with it — keeping them would leave
  a schedule pointing at questions that no longer exist.

  Quizzes stay at v1 deliberately. They're rules, not question references, so
  they survive the change; a rule naming a topic the new bank doesn't have shows
  "0 match" in the editor, which is visible and fixable.
*/
export const QUESTIONS_KEY = 'quizbot.questions.v2';
export const REVIEW_KEY = 'quizbot.review.v2';
export const QUIZZES_KEY = 'quizbot.quizzes.v1';
export const SESSIONS_KEY = 'quizbot.sessions.v2';

/**
 * Caps.
 *
 * The whole bank lives in one kv value, so growth is a real performance
 * concern: every write re-serializes everything. Debounced saves handle the
 * burst case; these caps handle the long-tail case.
 */
export const MAX_BANK_SIZE = 5000;
export const MAX_STORED_SESSIONS = 20;

export function isValidQuiz(value: unknown): value is Quiz {
  if (!value || typeof value !== 'object') return false;
  const quiz = value as Partial<Quiz>;
  if (typeof quiz.id !== 'string' || !quiz.id) return false;
  if (typeof quiz.name !== 'string' || !quiz.name) return false;
  if (typeof quiz.createdAt !== 'number') return false;
  const rule = quiz.rule;
  if (!rule || typeof rule !== 'object') return false;
  if (typeof rule.size !== 'number' || rule.size <= 0) return false;
  return rule.mix === 'balanced' || rule.mix === 'new-only' || rule.mix === 'review-only';
}

export function isValidSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<Session>;
  return (
    typeof session.id === 'string' &&
    !!session.id &&
    typeof session.quizName === 'string' &&
    typeof session.startedAt === 'number' &&
    typeof session.seed === 'number' &&
    typeof session.currentIndex === 'number' &&
    Array.isArray(session.items) &&
    (session.status === 'active' || session.status === 'completed' || session.status === 'abandoned')
  );
}

export const questionsConfig: PersistConfig<Question> = {
  key: QUESTIONS_KEY,
  version: 1,
  isValid: isValidQuestion,
};

export const reviewConfig: PersistConfig<ReviewState> = {
  key: REVIEW_KEY,
  version: 1,
  isValid: isValidReviewState,
};

export const quizzesConfig: PersistConfig<Quiz> = {
  key: QUIZZES_KEY,
  version: 1,
  isValid: isValidQuiz,
};

export const sessionsConfig: PersistConfig<Session> = {
  key: SESSIONS_KEY,
  version: 1,
  isValid: isValidSession,
};

/*
  Checked variants, so the stores can tell "nothing stored" apart from "the
  read failed". The distinction is the whole statistics-loss bug: an app update
  forces a cold launch, a cold launch is when the first synchronous read is
  most likely to fail transiently, and a failed read reported as "empty" makes
  every stat hydrate to zero — with the next write flattening the real history.
*/
export const loadQuestionsSync = () => loadSyncChecked(questionsConfig);
export const loadReviewSync = () => loadRecordSyncChecked(reviewConfig);
export const loadQuizzesSync = () => loadSyncChecked(quizzesConfig);
export const loadSessionsSync = () => loadSyncChecked(sessionsConfig);

/** Recovery reads — async, straight to storage, past the degraded flag. */
export const loadQuestionsAsync = () => loadAsync(questionsConfig);
export const loadReviewAsync = () => loadRecordAsync(reviewConfig);
export const loadQuizzesAsync = () => loadAsync(quizzesConfig);
export const loadSessionsAsync = () => loadAsync(sessionsConfig);

export const questionsSaver = createDebouncedSaver(questionsConfig);
export const reviewSaver = createDebouncedRecordSaver(reviewConfig);
export const quizzesSaver = createDebouncedSaver(quizzesConfig);
export const sessionsSaver = createDebouncedSaver(sessionsConfig);

/**
 * Trims the bank when it exceeds the cap, dropping the oldest questions that
 * carry no review history — losing something you've studied would destroy
 * progress, whereas an unseen question is replaceable by the generator.
 */
export function capBank(
  questions: readonly Question[],
  reviewStates: Readonly<Record<string, ReviewState>>,
  limit = MAX_BANK_SIZE,
): Question[] {
  if (questions.length <= limit) return questions.slice();

  const studied: Question[] = [];
  const unseen: Question[] = [];
  for (const question of questions) {
    if (reviewStates[question.id]) studied.push(question);
    else unseen.push(question);
  }

  // Newest unseen first, so eviction takes the stalest material.
  unseen.sort((a, b) => b.addedAt - a.addedAt);
  const room = Math.max(0, limit - studied.length);
  return [...studied, ...unseen.slice(0, room)];
}

/** Keeps the active session plus the most recent completed ones. */
export function capSessions(sessions: readonly Session[], limit = MAX_STORED_SESSIONS): Session[] {
  const active = sessions.filter((session) => session.status === 'active');
  const finished = sessions
    .filter((session) => session.status !== 'active')
    .sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt));
  return [...active, ...finished.slice(0, limit)];
}
