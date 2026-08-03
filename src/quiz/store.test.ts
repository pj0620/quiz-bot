jest.mock('../lib/kv', () => ({
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import {
  addQuestions,
  applyReview,
  bankStore,
  clearQuestionBank,
  createSession,
  getActiveSession,
  getQuestions,
  getQuizzes,
  getReviewStates,
  getSessions,
  ensureBuiltinQuizzes,
} from './store';
import type { MultipleChoiceQuestion } from './types';

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

beforeEach(() => {
  clearQuestionBank();
});

describe('clearQuestionBank', () => {
  it('empties the bank and reports how much went', () => {
    addQuestions([question('q1'), question('q2')]);
    expect(clearQuestionBank()).toEqual({ removed: 2 });
    expect(getQuestions()).toHaveLength(0);
  });

  it('clears review states, which are keyed by question id', () => {
    /*
      A partial reset is what makes this worth testing: review states pointing
      at questions that no longer exist would keep counting towards "due" and
      towards mastery, for cards nothing can ever show.
    */
    addQuestions([question('q1')]);
    applyReview('q1', 'correct');
    expect(Object.keys(getReviewStates())).toHaveLength(1);

    clearQuestionBank();
    expect(getReviewStates()).toEqual({});
  });

  it('clears sessions, so nothing is left mid-quiz over deleted questions', () => {
    addQuestions([question('q1'), question('q2')]);
    createSession({
      quizName: 'Test',
      questions: getQuestions(),
      newIds: new Set(getQuestions().map((entry) => entry.id)),
    });
    expect(getActiveSession()).toBeDefined();

    clearQuestionBank();
    expect(getSessions()).toHaveLength(0);
    expect(getActiveSession()).toBeUndefined();
  });

  it('leaves quizzes alone, because they are rules rather than references', () => {
    // A quiz is a filter over whatever the bank contains, so it keeps working
    // against the questions that replace these.
    ensureBuiltinQuizzes();
    const before = getQuizzes().length;
    expect(before).toBeGreaterThan(0);

    addQuestions([question('q1')]);
    clearQuestionBank();

    expect(getQuizzes()).toHaveLength(before);
  });

  it('is safe to run on an already empty bank', () => {
    expect(clearQuestionBank()).toEqual({ removed: 0 });
    expect(bankStore.get().questions).toEqual([]);
  });

  it('lets the same questions be re-added afterwards', () => {
    // Ids are deterministic, so a reset then regenerate must not be blocked by
    // the dedupe that normally makes re-running a no-op.
    addQuestions([question('q1')]);
    clearQuestionBank();
    expect(addQuestions([question('q1')])).toEqual({ added: 1 });
  });
});
