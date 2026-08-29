import { createStore } from '../lib/createStore';
import { hashString } from '../lib/random';
import { CALENDAR_TOPIC } from './calendar/types';
import { GEOGRAPHY_TOPIC } from './geography/types';
import { recordReview } from './srs/schedule';
import {
  capBank,
  capSessions,
  loadQuestionsAsync,
  loadQuestionsSync,
  loadQuizzesAsync,
  loadQuizzesSync,
  loadReviewAsync,
  loadReviewSync,
  loadSessionsAsync,
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
  SelfGrade,
  Session,
} from './types';
import { isGraded } from './types';

/**
 * Four stores, following the convention already established by
 * `src/sources/store.ts`: module-level creation with synchronous hydration, a
 * private fire-and-forget persist, exported free functions as the only mutation
 * API, and non-hook getters for imperative callers.
 *
 * Hydration here is CHECKED: each load reports whether its read failed, and a
 * failure schedules `recoverQuizStoresFromStorage` — the same defence
 * `llm/settings.ts` grew when the reader's generation notes were being lost
 * "on app updates". The stats screen is computed entirely from these stores,
 * so without recovery the same cold-launch read failure wipes every statistic:
 * the stores hydrate empty, and the first write persists that emptiness over
 * the real history.
 */

/*
  What changed THIS session, per store. Recovery must never overwrite work the
  user has done since launch — their answers are newer than anything on disk —
  so an untouched store is restored wholesale, while a touched one is merged
  with the in-memory copy winning on collision. Set by the persist helpers,
  which every user-driven mutation goes through; built-in seeding deliberately
  does not count (see `ensureBuiltinQuizzes`).
*/
let bankTouched = false;
let reviewTouched = false;
let quizzesTouched = false;
let sessionsTouched = false;

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

type BankState = { questions: Question[] };

const hydratedQuestions = loadQuestionsSync();

export const bankStore = createStore<BankState>({ questions: hydratedQuestions.items });

function persistBank(questions: Question[]): void {
  bankTouched = true;
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

/**
 * Replaces a question in place, keeping its id.
 *
 * The id is the whole point of "in place". It keys review state, session items
 * and coverage, and it is normally derived from a hash of the prompt — so
 * letting an edit re-derive it would silently orphan the user's entire history
 * with that question and hand them a brand new card at interval zero. An edit
 * is a correction to something they already know, not a different question.
 *
 * Caller's job to preserve it; this refuses anything else rather than writing a
 * duplicate under a new id.
 */
export function updateQuestion(next: Question): boolean {
  const state = bankStore.get();
  if (!state.questions.some((question) => question.id === next.id)) return false;

  const questions = state.questions.map((question) =>
    question.id === next.id ? next : question,
  );
  bankStore.set({ questions });
  persistBank(questions);
  return true;
}

/**
 * Deletes questions and everything pointing at them.
 *
 * One function rather than three, for the reason `clearQuestionBank` gives: a
 * partial delete leaves states that look like bugs. A leftover review state
 * keeps counting towards "due" for a card nothing can show, and a session item
 * referencing a deleted question drops the player into its "nothing left to
 * answer" screen mid-quiz.
 *
 * `currentIndex` is clamped after the items are removed, so deleting the
 * question you are looking at lands on the next one rather than off the end.
 *
 * Takes a LIST rather than being called in a loop, because the bank screen can
 * now delete a whole filtered view at once. Looping would rewrite and re-persist
 * every store once per question — quadratic on the bank, and hundreds of
 * scheduled writes — where the work here is the same three passes whether one
 * question is going or a thousand.
 */
export function deleteQuestions(questionIds: readonly string[]): { removed: number } {
  const doomed = new Set(questionIds);
  if (doomed.size === 0) return { removed: 0 };

  const state = bankStore.get();
  const questions = state.questions.filter((question) => !doomed.has(question.id));
  const removed = state.questions.length - questions.length;
  if (removed === 0) return { removed: 0 };

  bankStore.set({ questions });
  persistBank(questions);

  const states = { ...reviewStore.get().states };
  let reviewsChanged = false;
  for (const id of doomed) {
    if (states[id]) {
      delete states[id];
      reviewsChanged = true;
    }
  }
  if (reviewsChanged) {
    reviewStore.set({ states });
    persistReview(states);
  }

  /*
    Only UNSETTLED items, and only in a session still running.

    An item the user already answered or flagged is history: it is counted on
    the results screen and in their streak, and quietly deleting it rewrites
    what they did. A finished session is history entire. What genuinely breaks
    is an item still waiting to be asked whose question no longer exists — the
    player looks it up, finds nothing, and shows "nothing left to answer" in the
    middle of a quiz. That is the only case worth removing.
  */
  let sessionsChanged = false;
  const sessions = sessionsStore.get().sessions.map((session) => {
    if (session.status !== 'active') return session;
    const items = session.items.filter(
      (item) => !doomed.has(item.questionId) || !!item.outcome || !!item.flagged,
    );
    if (items.length === session.items.length) return session;
    sessionsChanged = true;
    return {
      ...session,
      items,
      currentIndex: Math.min(session.currentIndex, Math.max(0, items.length - 1)),
    };
  });
  if (sessionsChanged) {
    sessionsStore.set({ sessions });
    persistSessions(sessions);
  }

  return { removed };
}

/** The single-question case, which is all the detail screen ever needs. */
export function deleteQuestion(questionId: string): boolean {
  return deleteQuestions([questionId]).removed > 0;
}

/** Called when a source is disconnected — its questions have no meaning without it. */
export function removeQuestionsForSource(sourceId: string): void {
  const state = bankStore.get();
  const questions = state.questions.filter((question) => question.sourceId !== sourceId);
  if (questions.length === state.questions.length) return;
  bankStore.set({ questions });
  persistBank(questions);
}

/**
 * Empties the bank and everything keyed to it.
 *
 * Deliberately one function rather than three, because a partial reset leaves
 * the app in states that look like bugs: review states pointing at questions
 * that no longer exist, and an "in progress" session that can never be
 * finished. Quizzes are left alone — they are rules over the bank, not
 * references into it, so they keep working against whatever replaces it.
 *
 * The COVERAGE ledger is the caller's job, and skipping it is the mistake
 * worth guarding against: clearing the bank without clearing coverage leaves
 * every note marked "already covered", so regeneration finds nothing to do and
 * the bank stays empty with no explanation.
 */
export function clearQuestionBank(): { removed: number } {
  const removed = bankStore.get().questions.length;

  // An explicit clear also calls off any pending hydration recovery for these
  // stores: the user has declared the data gone, and a recovery read landing
  // afterwards must not put it back.
  pendingRecovery.questions = false;
  pendingRecovery.review = false;
  pendingRecovery.sessions = false;

  bankStore.set({ questions: [] });
  persistBank([]);

  reviewStore.set({ states: {} });
  persistReview({});

  sessionsStore.set({ sessions: [] });
  persistSessions([]);

  return { removed };
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

const hydratedReview = loadReviewSync();

export const reviewStore = createStore<ReviewStoreState>({ states: hydratedReview.items });

function persistReview(states: Record<string, ReviewState>): void {
  reviewTouched = true;
  reviewSaver.schedule(states);
}

export function applyReview(questionId: string, outcome: Outcome, now = Date.now()): ReviewState {
  const current = reviewStore.get().states;
  const next = recordReview(current[questionId], questionId, outcome, now);
  const states = { ...current, [questionId]: next };
  reviewStore.set({ states });
  persistReview(states);
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
  persistReview(states);
}

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

type QuizzesState = { quizzes: Quiz[] };

const hydratedQuizzes = loadQuizzesSync();

export const quizzesStore = createStore<QuizzesState>({ quizzes: hydratedQuizzes.items });

function persistQuizzes(quizzes: Quiz[]): void {
  quizzesTouched = true;
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

  /*
    Seed only in memory while recovery for this store is pending, and don't
    mark the store as touched either way — this runs at every launch, not on a
    user's say-so. When the quizzes read failed at hydration, the store looks
    like a first run, so this reseeds the built-ins; persisting THAT would race
    the recovery read and could replace the user's real quizzes (edits,
    lastSessionAt, their own quizzes) with a fresh set of defaults. Recovery
    re-runs this once the stored quizzes are back.
  */
  if (pendingRecovery.quizzes) return;
  quizzesSaver.schedule(quizzes);
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
  {
    id: 'builtin:geography',
    name: 'Geography',
    icon: 'globe-outline',
    builtin: true,
    createdAt: 0,
    /*
      Seeded like the others, and empty until a subject is switched on in
      Settings — geography questions are derived from the enabled subjects, so
      this quiz draws nothing at all by default.

      `mix: 'balanced'` rather than 'new-only' because the catalog is fixed and
      finite: once you have seen all fifty states there is nothing new left, and
      a new-only rule would go permanently empty at exactly the point the
      reader most needs review.
    */
    rule: { size: 10, mix: 'balanced', topics: [GEOGRAPHY_TOPIC] },
  },
  {
    id: 'builtin:calendar',
    name: 'Calendar',
    icon: 'calendar-outline',
    builtin: true,
    createdAt: 0,
    // Same shape as the geography quiz, for the same reasons: empty until a
    // subject is switched on in Settings, and `balanced` because the catalog
    // is finite — a new-only rule would go permanently empty at exactly the
    // point the reader most needs review.
    rule: { size: 10, mix: 'balanced', topics: [CALENDAR_TOPIC] },
  },
];

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

type SessionsState = { sessions: Session[] };

const hydratedSessions = loadSessionsSync();

export const sessionsStore = createStore<SessionsState>({ sessions: hydratedSessions.items });

function persistSessions(sessions: Session[], immediate = false): void {
  sessionsTouched = true;
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

/**
 * "I don't know" — reveals the answer and records it as missed.
 *
 * A separate function rather than submitting a blank answer through
 * `answerSessionItem`, and the reason is true/false. There is no empty value
 * for a boolean, so a blank submission would be graded against the correct
 * answer and come out RIGHT half the time. Giving up would then be rewarded
 * with a tick and a strengthened review interval, which is the exact opposite
 * of what the button means.
 *
 * So the outcome is stated, not derived. No `answer` is stored either: the user
 * did not give one, and inventing a plausible-looking blank answer to satisfy
 * the type would show up as their attempt on the results screen.
 *
 * Everything else matches `answerSessionItem` — same flagged-item exemption, so
 * a question the user has declared broken still doesn't damage their schedule.
 */
export function giveUpSessionItem(
  sessionId: string,
  questionId: string,
  now = Date.now(),
): Grade | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  const grade: Grade = { status: 'graded', outcome: 'incorrect', score: 0 };

  const items = session.items.map((item) =>
    item.questionId === questionId
      ? { ...item, grade, outcome: grade.outcome, answeredAt: now }
      : item,
  );
  replaceSession({ ...session, items });

  if (!session.items.find((item) => item.questionId === questionId)?.flagged) {
    applyReview(questionId, grade.outcome, now);
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

/**
 * Moves the player to an arbitrary item — the back arrow, and the walk forward
 * again after it. Clamped rather than validated: the player computes the
 * target from the same session it renders, so anything out of range here is a
 * race with a delete, and landing on the nearest real item beats crashing.
 */
export function setSessionIndex(sessionId: string, index: number): void {
  const session = getSessionById(sessionId);
  if (!session) return;
  const clamped = Math.max(0, Math.min(index, Math.max(0, session.items.length - 1)));
  if (clamped === session.currentIndex) return;
  replaceSession({ ...session, currentIndex: clamped });
}

/**
 * Overrules the recorded verdict on an already-settled item.
 *
 * This is what the back arrow exists FOR: you press Next, realise a beat later
 * the tick was wrong — you misread your own answer, or the judge was too
 * kind — and go back to set the record straight. It rewrites the item's grade
 * and outcome in place, keeps a short-answer's `selfGrade` in step (the
 * results screen reads it), and never invents an `answer` the reader did not
 * give.
 *
 * The review schedule is re-fed the corrected outcome, exactly as the
 * existing "I got that right" override after model marking does: SM-2 has no
 * undo, so the correction is applied as a further review rather than a
 * rewrite of history. The direction is what matters — a wrong "correct" would
 * otherwise push the question months out.
 *
 * Flagged items stay exempt, the same rule every other grading path follows.
 */
export function overrideSessionItemOutcome(
  sessionId: string,
  questionId: string,
  outcome: Outcome,
  now = Date.now(),
): void {
  const session = getSessionById(sessionId);
  if (!session) return;
  const item = session.items.find((entry) => entry.questionId === questionId);
  // Only settled items can be re-marked — an unanswered one has no verdict to flip.
  if (!item || (item.outcome === undefined && item.grade === undefined)) return;

  const grade: Grade = {
    status: 'graded',
    outcome,
    score: outcome === 'correct' ? 1 : outcome === 'partial' ? 0.5 : 0,
  };

  const answer =
    item.answer?.format === 'short-answer'
      ? {
          ...item.answer,
          selfGrade: (outcome === 'correct'
            ? 'got-it'
            : outcome === 'partial'
              ? 'close'
              : 'missed') as SelfGrade,
        }
      : item.answer;

  const items = session.items.map((entry) =>
    entry.questionId === questionId
      ? { ...entry, ...(answer ? { answer } : {}), grade, outcome, answeredAt: entry.answeredAt ?? now }
      : entry,
  );
  replaceSession({ ...session, items });

  if (!item.flagged) applyReview(questionId, outcome, now);
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

/** The resumable session the Stats tab surfaces, if any. */
export function getActiveSession(): Session | undefined {
  return sessionsStore.get().sessions.find((session) => session.status === 'active');
}

// ---------------------------------------------------------------------------
// Hydration recovery
// ---------------------------------------------------------------------------

/*
  The "my statistics vanished after an app update" bug, and its fix — the same
  one `llm/settings.ts` grew for the reader's generation notes.

  An update forces a cold launch, a cold launch is when the very first
  synchronous read is most likely to fail transiently, and a failed read used
  to be indistinguishable from "nothing stored": the stores hydrated empty,
  every stat computed from them showed zero, and the next write — answering a
  single question was enough — persisted that emptiness over the real history.

  So hydration now records WHICH reads failed, and this schedules an async
  re-read for exactly those stores. Async reads go straight to storage and
  bypass the degraded flag, so this cannot be fooled by other modules' reads
  succeeding in the meantime.
*/
const pendingRecovery = {
  questions: hydratedQuestions.failed,
  review: hydratedReview.failed,
  quizzes: hydratedQuizzes.failed,
  sessions: hydratedSessions.failed,
};

function anyRecoveryPending(): boolean {
  return (
    pendingRecovery.questions ||
    pendingRecovery.review ||
    pendingRecovery.quizzes ||
    pendingRecovery.sessions
  );
}

/*
  The apply helpers below share one rule: an untouched store is replaced
  wholesale and NOT persisted (what came back is what storage already holds),
  while a touched store is merged — in-memory wins on collision, because the
  user's work this session is newer than anything on disk — and the merged
  result is persisted, since it is now the only complete copy anywhere.
*/

function applyRecoveredQuestions(recovered: Question[]): void {
  if (!bankTouched) {
    bankStore.set({ questions: recovered });
    return;
  }
  const current = bankStore.get().questions;
  const seen = new Set(current.map((question) => question.id));
  const questions = capBank(
    [...current, ...recovered.filter((question) => !seen.has(question.id))],
    reviewStore.get().states,
  );
  bankStore.set({ questions });
  persistBank(questions);
}

function applyRecoveredReview(recovered: Record<string, ReviewState>): void {
  if (!reviewTouched) {
    reviewStore.set({ states: recovered });
    return;
  }
  const states = { ...recovered, ...reviewStore.get().states };
  reviewStore.set({ states });
  persistReview(states);
}

function applyRecoveredQuizzes(recovered: Quiz[]): void {
  if (!quizzesTouched) {
    quizzesStore.set({ quizzes: recovered });
    return;
  }
  const current = quizzesStore.get().quizzes;
  const seen = new Set(current.map((quiz) => quiz.id));
  const quizzes = [...current, ...recovered.filter((quiz) => !seen.has(quiz.id))];
  quizzesStore.set({ quizzes });
  persistQuizzes(quizzes);
}

function applyRecoveredSessions(recovered: Session[]): void {
  if (!sessionsTouched) {
    sessionsStore.set({ sessions: recovered });
    return;
  }
  const current = sessionsStore.get().sessions;
  const seen = new Set(current.map((session) => session.id));
  const sessions = capSessions([
    ...current,
    ...recovered.filter((session) => !seen.has(session.id)),
  ]);
  sessionsStore.set({ sessions });
  persistSessions(sessions);
}

/**
 * Puts stored data back after a hydration read that FAILED (as opposed to one
 * that found nothing stored). Retries on a backoff, since the usual cause —
 * the database briefly unopenable at cold launch — clears itself within
 * moments. Each store is restored the moment its own read answers; the loop
 * keeps going for whichever are still pending. Returns whether anything was
 * recovered.
 */
export async function recoverQuizStoresFromStorage(
  delays: readonly number[] = [500, 2_000, 8_000],
): Promise<boolean> {
  let recovered = false;

  for (let attempt = 0; ; attempt += 1) {
    const [questions, review, quizzes, sessions] = await Promise.all([
      pendingRecovery.questions ? loadQuestionsAsync() : Promise.resolve(null),
      pendingRecovery.review ? loadReviewAsync() : Promise.resolve(null),
      pendingRecovery.quizzes ? loadQuizzesAsync() : Promise.resolve(null),
      pendingRecovery.sessions ? loadSessionsAsync() : Promise.resolve(null),
    ]);

    if (questions !== null) {
      pendingRecovery.questions = false;
      applyRecoveredQuestions(questions);
      recovered = true;
    }
    if (review !== null) {
      pendingRecovery.review = false;
      applyRecoveredReview(review);
      recovered = true;
    }
    if (quizzes !== null) {
      pendingRecovery.quizzes = false;
      applyRecoveredQuizzes(quizzes);
      recovered = true;
      // Seeding was suppressed while this store's recovery was pending; now
      // that the real quizzes are back, fill in any genuinely missing built-ins.
      ensureBuiltinQuizzes();
    }
    if (sessions !== null) {
      pendingRecovery.sessions = false;
      applyRecoveredSessions(sessions);
      recovered = true;
    }

    if (!anyRecoveryPending() || attempt >= delays.length) return recovered;
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }
}

if (anyRecoveryPending()) {
  void recoverQuizStoresFromStorage().catch(() => undefined);
}
