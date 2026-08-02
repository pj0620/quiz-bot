import { createStore } from '../lib/createStore';
import { hashString } from '../lib/random';
import { recordReview } from './srs/schedule';
import {
  capBank,
  capSessions,
  loadQuestionsSync,
  loadQuizzesSync,
  loadReviewSync,
  loadSessionsSync,
  questionsSaver,
  quizzesSaver,
  reviewSaver,
  sessionsSaver,
} from './storage';
import { gradeAnswer } from './questionTypes/registry';
import type {
  Answer,
  FlagReason,
  Grade,
  Outcome,
  Question,
  Quiz,
  ReviewState,
  Session,
} from './types';
import { isGraded } from './types';

/**
 * Four stores, following the convention already established by
 * `src/sources/store.ts`: module-level creation with synchronous hydration, a
 * private fire-and-forget persist, exported free functions as the only mutation
 * API, and non-hook getters for imperative callers.
 */

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

type BankState = { questions: Question[] };

export const bankStore = createStore<BankState>({ questions: loadQuestionsSync() });

function persistBank(questions: Question[]): void {
  questionsSaver.schedule(questions);
}

/**
 * Ingests generated questions.
 *
 * Existing rows win on id collision, which is what makes re-running the
 * generator over unchanged material a no-op: ids are derived deterministically
 * from content, so a duplicate means "already have this", not "new version".
 */
export function addQuestions(incoming: readonly Question[]): { added: number } {
  const state = bankStore.get();
  const byId = new Map(state.questions.map((question) => [question.id, question]));

  let added = 0;
  for (const question of incoming) {
    if (byId.has(question.id)) continue;
    byId.set(question.id, question);
    added += 1;
  }
  if (added === 0) return { added: 0 };

  const questions = capBank(Array.from(byId.values()), reviewStore.get().states);
  bankStore.set({ questions });
  persistBank(questions);
  return { added };
}

export function flagQuestion(questionId: string, reason: FlagReason, note?: string): void {
  const state = bankStore.get();
  const questions = state.questions.map((question) =>
    question.id === questionId
      ? { ...question, flagged: { reason, note, at: Date.now() } }
      : question,
  );
  bankStore.set({ questions });
  persistBank(questions);
}

export function unflagQuestion(questionId: string): void {
  const state = bankStore.get();
  const questions = state.questions.map((question) => {
    if (question.id !== questionId) return question;
    const { flagged: _flagged, ...rest } = question;
    return rest as Question;
  });
  bankStore.set({ questions });
  persistBank(questions);
}

/** Called when a source is disconnected — its questions have no meaning without it. */
export function removeQuestionsForSource(sourceId: string): void {
  const state = bankStore.get();
  const questions = state.questions.filter((question) => question.sourceId !== sourceId);
  if (questions.length === state.questions.length) return;
  bankStore.set({ questions });
  persistBank(questions);
}

export function getQuestions(): Question[] {
  return bankStore.get().questions;
}

export function getQuestionById(id: string): Question | undefined {
  return bankStore.get().questions.find((question) => question.id === id);
}

// ---------------------------------------------------------------------------
// Review states
// ---------------------------------------------------------------------------

type ReviewStoreState = { states: Record<string, ReviewState> };

export const reviewStore = createStore<ReviewStoreState>({ states: loadReviewSync() });

export function applyReview(questionId: string, outcome: Outcome, now = Date.now()): ReviewState {
  const current = reviewStore.get().states;
  const next = recordReview(current[questionId], questionId, outcome, now);
  const states = { ...current, [questionId]: next };
  reviewStore.set({ states });
  reviewSaver.schedule(states);
  return next;
}

export function getReviewStates(): Record<string, ReviewState> {
  return reviewStore.get().states;
}

export function resetReview(questionId: string): void {
  const current = reviewStore.get().states;
  if (!current[questionId]) return;
  const { [questionId]: _removed, ...states } = current;
  reviewStore.set({ states });
  reviewSaver.schedule(states);
}

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

type QuizzesState = { quizzes: Quiz[] };

export const quizzesStore = createStore<QuizzesState>({ quizzes: loadQuizzesSync() });

function persistQuizzes(quizzes: Quiz[]): void {
  quizzesSaver.schedule(quizzes);
}

export function upsertQuiz(quiz: Quiz): void {
  const state = quizzesStore.get();
  const index = state.quizzes.findIndex((existing) => existing.id === quiz.id);
  const quizzes =
    index === -1
      ? [...state.quizzes, quiz]
      : state.quizzes.map((existing) => (existing.id === quiz.id ? quiz : existing));
  quizzesStore.set({ quizzes });
  persistQuizzes(quizzes);
}

export function removeQuiz(quizId: string): void {
  const state = quizzesStore.get();
  // Built-ins can be edited but not deleted — they're the app's spine.
  const quizzes = state.quizzes.filter((quiz) => quiz.id !== quizId || quiz.builtin);
  if (quizzes.length === state.quizzes.length) return;
  quizzesStore.set({ quizzes });
  persistQuizzes(quizzes);
}

export function getQuizzes(): Quiz[] {
  return quizzesStore.get().quizzes;
}

export function getQuizById(id: string): Quiz | undefined {
  return quizzesStore.get().quizzes.find((quiz) => quiz.id === id);
}

/** Seeds the built-in quizzes on first run. Idempotent. */
export function ensureBuiltinQuizzes(now = Date.now()): void {
  const existing = new Set(quizzesStore.get().quizzes.map((quiz) => quiz.id));
  const missing = BUILTIN_QUIZZES.filter((quiz) => !existing.has(quiz.id)).map((quiz) => ({
    ...quiz,
    createdAt: now,
  }));
  if (missing.length === 0) return;

  const quizzes = [...missing, ...quizzesStore.get().quizzes];
  quizzesStore.set({ quizzes });
  persistQuizzes(quizzes);
}

export const BUILTIN_QUIZZES: Quiz[] = [
  {
    id: 'builtin:daily',
    name: 'Daily quiz',
    icon: 'today-outline',
    builtin: true,
    createdAt: 0,
    rule: { size: 10, mix: 'balanced', addedWithinDays: 7 },
  },
  {
    id: 'builtin:weak-spots',
    name: 'Weak spots',
    icon: 'flash-outline',
    builtin: true,
    createdAt: 0,
    // Runs short when you're caught up rather than padding with easy material.
    rule: { size: 15, mix: 'review-only', maxMastery: 'shaky' },
  },
];

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

type SessionsState = { sessions: Session[] };

export const sessionsStore = createStore<SessionsState>({ sessions: loadSessionsSync() });

function persistSessions(sessions: Session[], immediate = false): void {
  sessionsSaver.schedule(sessions);
  // A completed session is worth a synchronous write — losing the last answer
  // of a finished quiz to a background kill would be very visible.
  if (immediate) sessionsSaver.flush();
}

function replaceSession(next: Session, immediate = false): void {
  const state = sessionsStore.get();
  const exists = state.sessions.some((session) => session.id === next.id);
  const sessions = capSessions(
    exists
      ? state.sessions.map((session) => (session.id === next.id ? next : session))
      : [next, ...state.sessions],
  );
  sessionsStore.set({ sessions });
  persistSessions(sessions, immediate);
}

export function createSession(input: {
  quizId?: string;
  quizName: string;
  questions: readonly Question[];
  newIds: ReadonlySet<string>;
  now?: number;
}): Session {
  const now = input.now ?? Date.now();
  const session: Session = {
    id: `session-${now}-${hashString(input.quizName + now).toString(36)}`,
    quizId: input.quizId,
    quizName: input.quizName,
    status: 'active',
    startedAt: now,
    seed: hashString(`${input.quizId ?? 'adhoc'}:${now}`),
    currentIndex: 0,
    items: input.questions.map((question) => ({
      questionId: question.id,
      // Captured at creation: once answered the review state changes, so this
      // can't be recomputed later — and it's what makes the results screen able
      // to say "4 of these were new to you".
      wasNew: input.newIds.has(question.id),
    })),
  };
  replaceSession(session);
  return session;
}

/**
 * Records an answer and advances review state.
 *
 * Deliberately skips `applyReview` for a flagged item: a question the user has
 * declared broken must not damage their schedule.
 */
export function answerSessionItem(
  sessionId: string,
  questionId: string,
  answer: Answer,
  question: Question,
  now = Date.now(),
): Grade | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  const grade = gradeAnswer(question, answer);
  const outcome = isGraded(grade) ? grade.outcome : undefined;

  const items = session.items.map((item) =>
    item.questionId === questionId ? { ...item, answer, grade, outcome, answeredAt: now } : item,
  );
  replaceSession({ ...session, items });

  if (outcome && !session.items.find((item) => item.questionId === questionId)?.flagged) {
    applyReview(questionId, outcome, now);
  }
  return grade;
}

export function flagSessionItem(sessionId: string, questionId: string): void {
  const session = getSessionById(sessionId);
  if (!session) return;
  const items = session.items.map((item) =>
    item.questionId === questionId ? { ...item, flagged: true } : item,
  );
  replaceSession({ ...session, items });
}

export function advanceSession(sessionId: string): void {
  const session = getSessionById(sessionId);
  if (!session) return;
  replaceSession({ ...session, currentIndex: Math.min(session.currentIndex + 1, session.items.length) });
}

export function completeSession(sessionId: string, now = Date.now()): void {
  const session = getSessionById(sessionId);
  if (!session) return;
  replaceSession({ ...session, status: 'completed', completedAt: now }, true);

  if (session.quizId) {
    const quiz = getQuizById(session.quizId);
    if (quiz) upsertQuiz({ ...quiz, lastSessionAt: now });
  }
}

export function abandonSession(sessionId: string, now = Date.now()): void {
  const session = getSessionById(sessionId);
  if (!session) return;
  replaceSession({ ...session, status: 'abandoned', completedAt: now }, true);
}

export function getSessions(): Session[] {
  return sessionsStore.get().sessions;
}

export function getSessionById(id: string): Session | undefined {
  return sessionsStore.get().sessions.find((session) => session.id === id);
}

/** The resumable session Today surfaces, if any. */
export function getActiveSession(): Session | undefined {
  return sessionsStore.get().sessions.find((session) => session.status === 'active');
}
