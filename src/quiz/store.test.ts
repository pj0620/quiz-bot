jest.mock('../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
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
  flagSessionItem,
  giveUpSessionItem,
  advanceSession,
  answerSessionItem,
  completeSession,
  deleteQuestion,
  deleteQuestions,
  updateQuestion,
} from './store';
import type { MultipleChoiceQuestion, Question, TrueFalseQuestion } from './types';

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

describe('giveUpSessionItem — "I don’t know"', () => {
  function trueFalse(id: string, correct: boolean): TrueFalseQuestion {
    return {
      id,
      prompt: `Claim ${id}`,
      explanation: 'Because.',
      topics: ['history-of-america'],
      difficulty: 'core',
      sourceId: 'src-1',
      provenance: { sourceId: 'src-1', path: 'a.md' },
      addedAt: 1_000,
      format: 'true-false',
      correct,
    };
  }

  function start(questions: Question[]) {
    addQuestions(questions);
    createSession({
      quizName: 'Test',
      questions: getQuestions(),
      newIds: new Set(getQuestions().map((entry) => entry.id)),
    });
    return getActiveSession()!;
  }

  it('records the question as missed and reveals it', () => {
    const session = start([question('q1')]);
    const grade = giveUpSessionItem(session.id, 'q1');

    expect(grade).toEqual({ status: 'graded', outcome: 'incorrect', score: 0 });
    const item = getActiveSession()!.items.find((entry) => entry.questionId === 'q1');
    expect(item?.outcome).toBe('incorrect');
    expect(item?.answeredAt).toBeDefined();
  });

  it('never counts as correct on true/false, whichever way the answer falls', () => {
    /*
      The reason this is a separate function rather than a blank submission
      through `answerSessionItem`. A boolean has no empty value, so a blank
      would be graded against the correct answer and come out RIGHT half the
      time — rewarding giving up with a tick and a longer review interval.
    */
    for (const correct of [true, false]) {
      clearQuestionBank();
      const session = start([trueFalse('tf', correct)]);
      expect(giveUpSessionItem(session.id, 'tf')).toMatchObject({ outcome: 'incorrect' });
    }
  });

  it('stores no answer, because the user did not give one', () => {
    // An invented blank answer would be shown back to them as their attempt.
    const session = start([question('q1')]);
    giveUpSessionItem(session.id, 'q1');
    expect(getActiveSession()!.items[0].answer).toBeUndefined();
  });

  it('schedules the question for review as missed', () => {
    const session = start([question('q1')]);
    giveUpSessionItem(session.id, 'q1');
    expect(getReviewStates()['q1']).toBeDefined();
  });

  it('leaves the schedule alone for a question the user flagged as broken', () => {
    // Matches `answerSessionItem`: a question declared broken must not damage
    // the schedule, however it was settled.
    const session = start([question('q1')]);
    flagSessionItem(session.id, 'q1');
    giveUpSessionItem(session.id, 'q1');

    expect(getActiveSession()!.items[0].outcome).toBe('incorrect');
    expect(getReviewStates()['q1']).toBeUndefined();
  });

  it('returns null for a session that no longer exists', () => {
    expect(giveUpSessionItem('missing-session', 'q1')).toBeNull();
  });
});

describe('editing and deleting one question', () => {
  function start(ids: string[]) {
    addQuestions(ids.map((id) => question(id)));
    createSession({
      quizName: 'Test',
      questions: getQuestions(),
      newIds: new Set(ids),
    });
    return getActiveSession()!;
  }

  it('replaces a question in place', () => {
    addQuestions([question('q1')]);
    const edited = { ...question('q1'), prompt: 'A better prompt' };

    expect(updateQuestion(edited)).toBe(true);
    expect(getQuestions()[0].prompt).toBe('A better prompt');
    expect(getQuestions()).toHaveLength(1);
  });

  it('keeps review history across an edit, because the id is the key', () => {
    /*
      The whole reason edits go through `updateQuestion` rather than
      delete-then-add. Ids are hashed from the prompt at generation time, so a
      re-derived id would hand the user a brand new card at interval zero and
      silently discard everything they had already learned about this one.
    */
    addQuestions([question('q1')]);
    applyReview('q1', 'correct');
    const before = getReviewStates()['q1'];

    updateQuestion({ ...question('q1'), prompt: 'Reworded entirely' });
    expect(getReviewStates()['q1']).toEqual(before);
  });

  it('refuses to write a question that is not already in the bank', () => {
    // Otherwise a stale editor screen could resurrect a deleted question, or
    // add one under an id nothing else knows about.
    expect(updateQuestion(question('ghost'))).toBe(false);
    expect(getQuestions()).toHaveLength(0);
  });

  it('deletes the question and its review state together', () => {
    addQuestions([question('q1'), question('q2')]);
    applyReview('q1', 'correct');

    expect(deleteQuestion('q1')).toBe(true);
    expect(getQuestions().map((entry) => entry.id)).toEqual(['q2']);
    // A leftover state keeps counting towards "due" for a card nothing can show.
    expect(getReviewStates()['q1']).toBeUndefined();
  });

  it('reports when there was nothing to delete', () => {
    expect(deleteQuestion('missing')).toBe(false);
  });

  it('drops an unanswered item from the running session', () => {
    // The player looks items up by id; one pointing at a deleted question sends
    // it to "nothing left to answer" in the middle of a quiz.
    const session = start(['q1', 'q2', 'q3']);
    deleteQuestion('q2');

    const items = getActiveSession()!.items.map((item) => item.questionId);
    expect(items).toEqual(['q1', 'q3']);
    expect(getActiveSession()!.id).toBe(session.id);
  });

  it('keeps an item the user already answered, which is history', () => {
    /*
      Deleting a settled row would rewrite what the user actually did — the
      results screen counts these, and a quiz they scored 7/10 on would
      retroactively become 7/9.
    */
    const session = start(['q1', 'q2']);
    answerSessionItem(session.id, 'q1', { format: 'multiple-choice', choiceId: 'c0' }, question('q1'));

    deleteQuestion('q1');
    expect(getActiveSession()!.items.map((item) => item.questionId)).toEqual(['q1', 'q2']);
  });

  it('keeps items in a session that has already finished', () => {
    const session = start(['q1', 'q2']);
    completeSession(session.id);

    deleteQuestion('q1');
    const finished = getSessions().find((entry) => entry.id === session.id)!;
    expect(finished.items).toHaveLength(2);
  });

  it('clamps currentIndex so deleting the last question does not point off the end', () => {
    const session = start(['q1', 'q2']);
    advanceSession(session.id);
    expect(getActiveSession()!.currentIndex).toBe(1);

    deleteQuestion('q2');
    expect(getActiveSession()!.currentIndex).toBe(0);
    expect(getActiveSession()!.items).toHaveLength(1);
  });
});

describe('deleting a selection', () => {
  function start(ids: string[]) {
    addQuestions(ids.map((id) => question(id)));
    createSession({
      quizName: 'Test',
      questions: getQuestions(),
      newIds: new Set(ids),
    });
    return getActiveSession()!;
  }

  it('removes every question named and leaves the rest', () => {
    addQuestions([question('q1'), question('q2'), question('q3')]);

    expect(deleteQuestions(['q1', 'q3'])).toEqual({ removed: 2 });
    expect(getQuestions().map((entry) => entry.id)).toEqual(['q2']);
  });

  it('takes the review history of the whole selection with it', () => {
    addQuestions([question('q1'), question('q2'), question('q3')]);
    applyReview('q1', 'correct');
    applyReview('q2', 'incorrect');
    applyReview('q3', 'correct');

    deleteQuestions(['q1', 'q2']);
    expect(getReviewStates()['q1']).toBeUndefined();
    expect(getReviewStates()['q2']).toBeUndefined();
    // Untouched: a batch delete must not become a quiet reset of everything.
    expect(getReviewStates()['q3']).toBeDefined();
  });

  it('counts only what was actually there', () => {
    // The bank screen sends ids from a selection that may have gone stale —
    // another screen can delete the same question while it is ticked.
    addQuestions([question('q1')]);
    expect(deleteQuestions(['q1', 'never-existed'])).toEqual({ removed: 1 });
    expect(deleteQuestions([])).toEqual({ removed: 0 });
    expect(deleteQuestions(['q1'])).toEqual({ removed: 0 });
  });

  it('ignores duplicate ids rather than double-counting them', () => {
    addQuestions([question('q1'), question('q2')]);
    expect(deleteQuestions(['q1', 'q1'])).toEqual({ removed: 1 });
  });

  it('drops every unasked item from the running session in one pass', () => {
    const session = start(['q1', 'q2', 'q3', 'q4']);
    answerSessionItem(session.id, 'q1', { format: 'multiple-choice', choiceId: 'c0' }, question('q1'));

    deleteQuestions(['q1', 'q2', 'q3']);

    // q1 stays: it is answered, and removing it would rewrite what the user did.
    expect(getActiveSession()!.items.map((item) => item.questionId)).toEqual(['q1', 'q4']);
  });

  it('clamps currentIndex when the selection takes everything ahead of it', () => {
    const session = start(['q1', 'q2', 'q3']);
    advanceSession(session.id);
    advanceSession(session.id);
    expect(getActiveSession()!.currentIndex).toBe(2);

    deleteQuestions(['q2', 'q3']);
    expect(getActiveSession()!.currentIndex).toBe(0);
    expect(getActiveSession()!.items).toHaveLength(1);
  });
});
