/**
 * The "my statistics vanished after an app update" bug, as tests.
 *
 * The mechanism, same as the generation-notes bug before it: an update forces
 * a cold launch; the first synchronous read can fail transiently right then;
 * the four quiz stores hydrate empty, so every stat computed from them shows
 * zero; and the next write — answering one question is enough — persists that
 * emptiness over the real history. The fix under test: hydration records which
 * reads FAILED (as opposed to finding nothing), and a failed one schedules an
 * async recovery read that puts the stored data back.
 */

const mockKv = {
  store: new Map<string, string>(),
  /** Keys whose reads fail — the transient cold-launch failure, simulated. */
  broken: new Set<string>(),
  degraded: false,
};

jest.mock('../lib/kv', () => ({
  readJsonSync: (key: string) => {
    // Mirrors the real kv: the degraded flag reflects the most recent sync read.
    if (mockKv.broken.has(key)) {
      mockKv.degraded = true;
      return null;
    }
    mockKv.degraded = false;
    const raw = mockKv.store.get(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  isStorageDegraded: () => mockKv.degraded,
  getItemSync: (key: string) => mockKv.store.get(key) ?? null,
  // The real getItem swallows errors into null, and never touches the flag.
  getItem: async (key: string) => (mockKv.broken.has(key) ? null : (mockKv.store.get(key) ?? null)),
  setItem: async (key: string, value: string) => {
    mockKv.store.set(key, value);
  },
  writeJson: async (key: string, value: unknown) => {
    mockKv.store.set(key, JSON.stringify(value));
  },
  removeItem: async (key: string) => {
    mockKv.store.delete(key);
  },
}));

import type { MultipleChoiceQuestion, Quiz, ReviewState, Session } from './types';

const QUESTIONS_KEY = 'quizbot.questions.v2';
const REVIEW_KEY = 'quizbot.review.v2';
const QUIZZES_KEY = 'quizbot.quizzes.v1';
const SESSIONS_KEY = 'quizbot.sessions.v2';
const ALL_KEYS = [QUESTIONS_KEY, REVIEW_KEY, QUIZZES_KEY, SESSIONS_KEY];

type StoreModule = typeof import('./store');
type StorageModule = typeof import('./storage');

/** Fresh module instances against the mock's current state — a "launch". */
function launch(): { store: StoreModule; storage: StorageModule } {
  let store: StoreModule;
  let storage: StorageModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = require('./store') as StoreModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    storage = require('./storage') as StorageModule;
  });
  return { store: store!, storage: storage! };
}

// Under fake timers, this drains microtasks and zero-delay timeouts together.
const flushMicrotasks = () => jest.advanceTimersByTimeAsync(0);

function question(id: string): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history-of-america'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1', path: 'a.md' },
    addedAt: 1_000,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

function reviewState(questionId: string, reps: number): ReviewState {
  return {
    questionId,
    ease: 2.5,
    intervalDays: 3,
    dueAt: 2_000,
    streak: 2,
    lapses: 1,
    reps,
    lastReviewedAt: 1_000,
    lastOutcome: 'correct',
  };
}

function completedSession(id: string): Session {
  return {
    id,
    quizName: 'Daily quiz',
    status: 'completed',
    startedAt: 1_000,
    completedAt: 2_000,
    seed: 7,
    currentIndex: 1,
    items: [
      {
        questionId: 'q1',
        outcome: 'correct',
        grade: { status: 'graded', outcome: 'correct', score: 1 },
        answeredAt: 1_500,
        wasNew: true,
      },
    ],
  };
}

const customQuiz: Quiz = {
  id: 'quiz-mine',
  name: 'My quiz',
  icon: 'today-outline',
  createdAt: 1_000,
  rule: { size: 5, mix: 'balanced' },
};

/** The history a device would hold before the update. */
function seedStoredHistory(): void {
  mockKv.store.set(
    QUESTIONS_KEY,
    JSON.stringify({ version: 1, items: [question('q1'), question('q2')] }),
  );
  mockKv.store.set(
    REVIEW_KEY,
    JSON.stringify({ version: 1, items: { q1: reviewState('q1', 3), q2: reviewState('q2', 5) } }),
  );
  mockKv.store.set(
    QUIZZES_KEY,
    JSON.stringify({
      version: 1,
      items: [
        customQuiz,
        {
          id: 'builtin:daily',
          name: 'Daily quiz',
          builtin: true,
          createdAt: 1_000,
          lastSessionAt: 2_000,
          rule: { size: 10, mix: 'balanced' },
        },
      ],
    }),
  );
  mockKv.store.set(SESSIONS_KEY, JSON.stringify({ version: 1, items: [completedSession('s1')] }));
}

/*
  Fake timers, so each test can run the launch-time recovery loop — kicked off
  at module import with real backoff delays — to completion before the next
  test starts, instead of leaving its retry timers pending past the suite.
*/
beforeEach(() => {
  jest.useFakeTimers();
  mockKv.store.clear();
  mockKv.broken.clear();
  mockKv.degraded = false;
});

afterEach(async () => {
  mockKv.broken.clear();
  await jest.runAllTimersAsync();
  jest.useRealTimers();
});

describe('statistics persistence across a failed cold launch', () => {
  it('hydrates the stored history when reads succeed', () => {
    seedStoredHistory();
    const { store } = launch();

    expect(store.getQuestions()).toHaveLength(2);
    expect(Object.keys(store.getReviewStates())).toHaveLength(2);
    expect(store.getSessions()).toHaveLength(1);
    expect(store.getQuizzes()).toHaveLength(2);
  });

  /*
    THE reported bug, end to end: every read fails at the cold launch an app
    update forces, everything looks freshly installed — and it all comes back
    once storage answers again, instead of the next write flattening it.
  */
  it('recovers all four stores as soon as storage answers again', async () => {
    seedStoredHistory();
    for (const key of ALL_KEYS) mockKv.broken.add(key);

    const { store } = launch();
    expect(store.getQuestions()).toHaveLength(0);
    expect(store.getReviewStates()).toEqual({});
    expect(store.getSessions()).toHaveLength(0);

    mockKv.broken.clear();
    expect(await store.recoverQuizStoresFromStorage([])).toBe(true);

    expect(store.getQuestions().map((entry) => entry.id).sort()).toEqual(['q1', 'q2']);
    expect(store.getReviewStates().q2?.reps).toBe(5);
    expect(store.getSessions().map((entry) => entry.id)).toEqual(['s1']);
    expect(store.getQuizzes().some((quiz) => quiz.id === 'quiz-mine')).toBe(true);
  });

  it('never lets recovery overwrite what the user answered in the meantime', async () => {
    seedStoredHistory();
    // Only the review read fails — the partial outage that used to lose the
    // schedule while the bank survived.
    mockKv.broken.add(REVIEW_KEY);

    const { store, storage } = launch();
    expect(store.getReviewStates()).toEqual({});

    // The user gets there first — their answer is newer than anything stored.
    store.applyReview('q1', 'incorrect');
    const answered = store.getReviewStates().q1;
    mockKv.broken.clear();

    await store.recoverQuizStoresFromStorage([]);

    // q1 keeps this session's state; q2 comes back from storage.
    expect(store.getReviewStates().q1).toEqual(answered);
    expect(store.getReviewStates().q2?.reps).toBe(5);

    // The merge is now the only complete copy anywhere, so it IS persisted.
    storage.reviewSaver.flush();
    await flushMicrotasks();
    const persisted = JSON.parse(mockKv.store.get(REVIEW_KEY)!);
    expect(Object.keys(persisted.items).sort()).toEqual(['q1', 'q2']);
  });

  it('does not write back a store recovery restored untouched', async () => {
    seedStoredHistory();
    const before = mockKv.store.get(SESSIONS_KEY);
    for (const key of ALL_KEYS) mockKv.broken.add(key);

    const { store, storage } = launch();
    mockKv.broken.clear();
    await store.recoverQuizStoresFromStorage([]);

    // What came back is what storage already holds — nothing to save.
    storage.sessionsSaver.flush();
    await flushMicrotasks();
    expect(mockKv.store.get(SESSIONS_KEY)).toBe(before);
  });

  it('holds built-in reseeding back from storage until the real quizzes are recovered', async () => {
    seedStoredHistory();
    mockKv.broken.add(QUIZZES_KEY);
    const before = mockKv.store.get(QUIZZES_KEY);

    const { store, storage } = launch();
    // App startup reseeds the built-ins into the apparently-empty store; the
    // write that used to replace the user's quizzes with fresh defaults.
    store.ensureBuiltinQuizzes();
    expect(store.getQuizzes().length).toBeGreaterThan(0);

    storage.quizzesSaver.flush();
    await flushMicrotasks();
    expect(mockKv.store.get(QUIZZES_KEY)).toBe(before);

    mockKv.broken.clear();
    await store.recoverQuizStoresFromStorage([]);

    const quizzes = store.getQuizzes();
    expect(quizzes.some((quiz) => quiz.id === 'quiz-mine')).toBe(true);
    // The stored built-in wins over the reseeded one — its history survives.
    expect(quizzes.find((quiz) => quiz.id === 'builtin:daily')?.lastSessionAt).toBe(2_000);
  });

  it('reports failure when storage stays broken, rather than pretending', async () => {
    seedStoredHistory();
    for (const key of ALL_KEYS) mockKv.broken.add(key);

    const { store } = launch();
    expect(await store.recoverQuizStoresFromStorage([])).toBe(false);
    expect(store.getQuestions()).toHaveLength(0);
  });

  it('lets an explicit clear win over a pending recovery', async () => {
    seedStoredHistory();
    for (const key of ALL_KEYS) mockKv.broken.add(key);

    const { store } = launch();
    // The user has declared the data gone; a recovery read landing afterwards
    // must not put it back.
    store.clearQuestionBank();
    mockKv.broken.clear();

    await store.recoverQuizStoresFromStorage([]);
    expect(store.getQuestions()).toHaveLength(0);
    expect(store.getReviewStates()).toEqual({});
    expect(store.getSessions()).toHaveLength(0);
  });
});
