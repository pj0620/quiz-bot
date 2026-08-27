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
  answerSessionItem,
  clearQuestionBank,
  createSession,
  flagSessionItem,
  getQuestions,
  getReviewStates,
  getSessionById,
  giveUpSessionItem,
  overrideSessionItemOutcome,
  setSessionIndex,
} from './store';
import type { MultipleChoiceQuestion, Session, ShortAnswerQuestion } from './types';

function question(id: string): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history'],
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

function shortAnswer(id: string): ShortAnswerQuestion {
  return {
    id,
    prompt: `Say something about ${id}`,
    explanation: 'Because.',
    topics: ['history'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1', path: 'a.md' },
    addedAt: 1_000,
    format: 'short-answer',
    modelAnswer: 'The model answer.',
  };
}

function startSession(): Session {
  return createSession({
    quizName: 'Test',
    questions: getQuestions(),
    newIds: new Set(getQuestions().map((entry) => entry.id)),
  });
}

beforeEach(() => {
  clearQuestionBank();
});

describe('setSessionIndex', () => {
  it('moves the player to an earlier item and back again', () => {
    addQuestions([question('q1'), question('q2'), question('q3')]);
    const session = startSession();

    setSessionIndex(session.id, 2);
    expect(getSessionById(session.id)?.currentIndex).toBe(2);

    setSessionIndex(session.id, 0);
    expect(getSessionById(session.id)?.currentIndex).toBe(0);
  });

  it('clamps out-of-range targets instead of walking off the session', () => {
    addQuestions([question('q1'), question('q2')]);
    const session = startSession();

    setSessionIndex(session.id, 99);
    expect(getSessionById(session.id)?.currentIndex).toBe(1);

    setSessionIndex(session.id, -5);
    expect(getSessionById(session.id)?.currentIndex).toBe(0);
  });
});

describe('overrideSessionItemOutcome', () => {
  it('flips a graded answer and rewrites the grade with it', () => {
    addQuestions([question('q1')]);
    const session = startSession();
    const [stored] = getQuestions();

    answerSessionItem(session.id, 'q1', { format: 'multiple-choice', choiceId: 'c1' }, stored);
    expect(getSessionById(session.id)?.items[0].outcome).toBe('incorrect');

    overrideSessionItemOutcome(session.id, 'q1', 'correct');

    const item = getSessionById(session.id)?.items[0];
    expect(item?.outcome).toBe('correct');
    expect(item?.grade).toEqual({ status: 'graded', outcome: 'correct', score: 1 });
  });

  it('feeds the corrected outcome to the review schedule', () => {
    addQuestions([question('q1')]);
    const session = startSession();
    const [stored] = getQuestions();

    answerSessionItem(session.id, 'q1', { format: 'multiple-choice', choiceId: 'c1' }, stored);
    expect(getReviewStates()['q1'].lastOutcome).toBe('incorrect');

    overrideSessionItemOutcome(session.id, 'q1', 'correct');
    expect(getReviewStates()['q1'].lastOutcome).toBe('correct');
  });

  it('keeps a short answer’s selfGrade in step, for the results screen', () => {
    addQuestions([shortAnswer('q1')]);
    const session = startSession();
    const [stored] = getQuestions();

    answerSessionItem(
      session.id,
      'q1',
      { format: 'short-answer', text: 'my try', selfGrade: 'got-it' },
      stored,
    );
    overrideSessionItemOutcome(session.id, 'q1', 'incorrect');

    const answer = getSessionById(session.id)?.items[0].answer;
    expect(answer?.format === 'short-answer' && answer.selfGrade).toBe('missed');
  });

  it('re-marks a given-up item without inventing an answer for it', () => {
    addQuestions([question('q1')]);
    const session = startSession();

    giveUpSessionItem(session.id, 'q1');
    overrideSessionItemOutcome(session.id, 'q1', 'correct');

    const item = getSessionById(session.id)?.items[0];
    expect(item?.outcome).toBe('correct');
    // "I don't know" stored no answer, and the override must not fake one.
    expect(item?.answer).toBeUndefined();
  });

  it('refuses to mark an item that was never answered', () => {
    addQuestions([question('q1')]);
    const session = startSession();

    overrideSessionItemOutcome(session.id, 'q1', 'correct');

    const item = getSessionById(session.id)?.items[0];
    expect(item?.outcome).toBeUndefined();
    expect(item?.grade).toBeUndefined();
    expect(getReviewStates()['q1']).toBeUndefined();
  });

  it('leaves the schedule alone for a flagged item, like every grading path', () => {
    addQuestions([question('q1')]);
    const session = startSession();
    const [stored] = getQuestions();

    answerSessionItem(session.id, 'q1', { format: 'multiple-choice', choiceId: 'c0' }, stored);
    const before = getReviewStates()['q1'];

    flagSessionItem(session.id, 'q1');
    overrideSessionItemOutcome(session.id, 'q1', 'incorrect');

    // The item itself is re-marked…
    expect(getSessionById(session.id)?.items[0].outcome).toBe('incorrect');
    // …but a question the user declared broken must not damage the schedule.
    expect(getReviewStates()['q1']).toBe(before);
  });
});
