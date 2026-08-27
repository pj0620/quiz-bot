jest.mock('../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { parseEnvelope, parseRecordEnvelope } from '../lib/persist';
import type { MultipleChoiceQuestion, Question, Quiz, ReviewState, Session } from './types';
import {
  capBank,
  capSessions,
  isValidQuiz,
  isValidSession,
  questionsConfig,
  reviewConfig,
  quizzesConfig,
} from './storage';

const NOW = 1_700_000_000_000;

function q(id: string, addedAt = NOW): MultipleChoiceQuestion {
  return {
    id,
    format: 'multiple-choice',
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['auth'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1' },
    addedAt,
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctChoiceId: 'a',
  };
}

const reviewState = (id: string): ReviewState => ({
  questionId: id,
  ease: 2.5,
  intervalDays: 3,
  dueAt: NOW,
  streak: 1,
  lapses: 0,
  reps: 1,
  lastReviewedAt: NOW,
  lastOutcome: 'correct',
});

describe('question envelope', () => {
  it('round-trips valid rows', () => {
    const items = [q('1'), q('2')];
    expect(parseEnvelope({ version: 1, items }, questionsConfig)).toEqual(items);
  });

  it('discards an unknown version rather than guessing at a migration', () => {
    expect(parseEnvelope({ version: 99, items: [q('1')] }, questionsConfig)).toEqual([]);
  });

  /** The batch-safety property: one bad row must not lose the good ones. */
  it('drops a malformed row without dropping the batch', () => {
    const parsed = parseEnvelope({ version: 1, items: [q('1'), { id: 'bad' }, q('2')] }, questionsConfig);
    expect(parsed.map((question) => question.id)).toEqual(['1', '2']);
  });

  it('drops a row with an unknown format without dropping the batch', () => {
    const alien = { ...q('x'), format: 'essay' };
    const parsed = parseEnvelope({ version: 1, items: [q('1'), alien, q('2')] }, questionsConfig);
    expect(parsed.map((question) => question.id)).toEqual(['1', '2']);
  });

  it('drops a multiple-choice row whose correct answer is not among its choices', () => {
    const broken = { ...q('bad'), correctChoiceId: 'zzz' };
    const parsed = parseEnvelope({ version: 1, items: [q('1'), broken] }, questionsConfig);
    expect(parsed.map((question) => question.id)).toEqual(['1']);
  });

  it('handles junk envelopes', () => {
    expect(parseEnvelope(null, questionsConfig)).toEqual([]);
    expect(parseEnvelope({ version: 1 }, questionsConfig)).toEqual([]);
    expect(parseEnvelope({ version: 1, items: 'nope' }, questionsConfig)).toEqual([]);
  });
});

describe('review envelope', () => {
  it('round-trips a keyed record', () => {
    const items = { q1: reviewState('q1') };
    expect(parseRecordEnvelope({ version: 1, items }, reviewConfig)).toEqual(items);
  });

  it('drops invalid entries individually', () => {
    const items = { q1: reviewState('q1'), q2: { questionId: 'q2' } };
    const parsed = parseRecordEnvelope({ version: 1, items }, reviewConfig);
    expect(Object.keys(parsed)).toEqual(['q1']);
  });

  it('rejects an array where a record is expected', () => {
    expect(parseRecordEnvelope({ version: 1, items: [] }, reviewConfig)).toEqual({});
  });
});

describe('isValidQuiz', () => {
  const quiz: Quiz = {
    id: 'quiz-1',
    name: 'American History',
    icon: 'book-outline',
    createdAt: NOW,
    rule: { size: 10, mix: 'balanced' },
  };

  it('accepts a well-formed quiz', () => {
    expect(isValidQuiz(quiz)).toBe(true);
    expect(parseEnvelope({ version: 1, items: [quiz] }, quizzesConfig)).toEqual([quiz]);
  });

  it('rejects a rule with a bad size or mix', () => {
    expect(isValidQuiz({ ...quiz, rule: { size: 0, mix: 'balanced' } })).toBe(false);
    expect(isValidQuiz({ ...quiz, rule: { size: 10, mix: 'sideways' } })).toBe(false);
    expect(isValidQuiz({ ...quiz, rule: undefined })).toBe(false);
  });

  it('rejects missing identity fields', () => {
    expect(isValidQuiz({ ...quiz, id: '' })).toBe(false);
    expect(isValidQuiz({ ...quiz, name: '' })).toBe(false);
  });
});

describe('isValidSession', () => {
  const session: Session = {
    id: 's1',
    quizName: 'Daily',
    status: 'active',
    startedAt: NOW,
    seed: 1,
    currentIndex: 0,
    items: [],
  };

  it('accepts a well-formed session', () => {
    expect(isValidSession(session)).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(isValidSession({ ...session, status: 'paused' })).toBe(false);
  });

  it('rejects a non-array items field', () => {
    expect(isValidSession({ ...session, items: null })).toBe(false);
  });
});

describe('capBank', () => {
  it('leaves a small bank alone', () => {
    const bank = [q('1'), q('2')];
    expect(capBank(bank, {}, 10)).toEqual(bank);
  });

  /** Studied questions carry progress — evicting them would destroy real work. */
  it('never evicts a question with review history', () => {
    const bank = [q('studied', NOW - 100_000), q('fresh-1'), q('fresh-2')];
    const capped = capBank(bank, { studied: reviewState('studied') }, 2);
    expect(capped.map((question) => question.id)).toContain('studied');
    expect(capped).toHaveLength(2);
  });

  it('evicts the stalest unseen questions first', () => {
    const bank = [q('old', NOW - 500_000), q('mid', NOW - 100_000), q('new', NOW)];
    const capped = capBank(bank, {}, 2);
    expect(capped.map((question) => question.id).sort()).toEqual(['mid', 'new']);
  });

  it('keeps every studied question even past the limit', () => {
    const bank = [q('a'), q('b'), q('c')];
    const states = { a: reviewState('a'), b: reviewState('b'), c: reviewState('c') };
    expect(capBank(bank, states, 1)).toHaveLength(3);
  });
});

describe('capSessions', () => {
  const make = (id: string, status: Session['status'], completedAt?: number): Session => ({
    id,
    quizName: 'Daily',
    status,
    startedAt: NOW,
    completedAt,
    seed: 1,
    currentIndex: 0,
    items: [],
  });

  it('always keeps the active session', () => {
    const sessions = [
      make('active', 'active'),
      ...Array.from({ length: 30 }, (_, i) => make(`done-${i}`, 'completed', NOW - i * 1000)),
    ];
    const capped = capSessions(sessions, 5);
    expect(capped.find((session) => session.status === 'active')).toBeDefined();
    expect(capped).toHaveLength(6); // 1 active + 5 finished
  });

  it('keeps the most recently finished', () => {
    const sessions = [
      make('old', 'completed', NOW - 10_000),
      make('recent', 'completed', NOW),
    ];
    expect(capSessions(sessions, 1).map((session) => session.id)).toEqual(['recent']);
  });
});
