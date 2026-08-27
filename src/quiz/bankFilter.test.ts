import {
  applyBankFilter,
  countActiveFilters,
  emptyBankFilter,
  matchesBankFilter,
  sortQuestions,
  type BankFilter,
} from './bankFilter';
import type { MultipleChoiceQuestion, Question, ReviewState } from './types';

const DAY = 86_400_000;
/** A fixed "now" at local noon, away from midnight edge cases. */
const NOW = new Date(2026, 7, 21, 12, 0, 0).getTime();

function question(overrides: Partial<MultipleChoiceQuestion> & { id: string }): Question {
  return {
    prompt: `Prompt ${overrides.id}`,
    explanation: 'Because.',
    topics: ['history'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1', path: 'a.md' },
    addedAt: NOW,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
    ...overrides,
  };
}

function review(overrides: Partial<ReviewState>): ReviewState {
  return {
    questionId: 'q',
    ease: 2.5,
    intervalDays: 1,
    dueAt: NOW,
    streak: 0,
    lapses: 0,
    reps: 1,
    lastReviewedAt: NOW,
    lastOutcome: 'correct',
    ...overrides,
  };
}

function filter(overrides: Partial<BankFilter> = {}): BankFilter {
  return { ...emptyBankFilter(), ...overrides };
}

describe('matchesBankFilter', () => {
  it('matches everything when nothing is set', () => {
    expect(matchesBankFilter(question({ id: 'q1' }), filter(), undefined, NOW)).toBe(true);
  });

  it('reads topics as ANY-of, like quiz rules do', () => {
    const tagged = question({ id: 'q1', topics: ['auth', 'tokens'] });
    expect(matchesBankFilter(tagged, filter({ topics: ['auth', 'react'] }), undefined, NOW)).toBe(true);
    expect(matchesBankFilter(tagged, filter({ topics: ['react'] }), undefined, NOW)).toBe(false);
  });

  it('filters by any of several formats', () => {
    const q = question({ id: 'q1' });
    expect(matchesBankFilter(q, filter({ formats: ['true-false', 'multiple-choice'] }), undefined, NOW)).toBe(true);
    expect(matchesBankFilter(q, filter({ formats: ['true-false'] }), undefined, NOW)).toBe(false);
  });

  it('filters by difficulty', () => {
    const deep = question({ id: 'q1', difficulty: 'deep' });
    expect(matchesBankFilter(deep, filter({ difficulties: ['deep'] }), undefined, NOW)).toBe(true);
    expect(matchesBankFilter(deep, filter({ difficulties: ['intro'] }), undefined, NOW)).toBe(false);
  });

  it('filters by when a question entered the bank, in calendar days', () => {
    const today = question({ id: 'q1', addedAt: NOW - 2 * 60 * 60 * 1000 });
    const lastWeek = question({ id: 'q2', addedAt: NOW - 5 * DAY });
    const lastMonth = question({ id: 'q3', addedAt: NOW - 20 * DAY });

    const todayOnly = filter({ addedWithinDays: 1 });
    expect(matchesBankFilter(today, todayOnly, undefined, NOW)).toBe(true);
    expect(matchesBankFilter(lastWeek, todayOnly, undefined, NOW)).toBe(false);

    const week = filter({ addedWithinDays: 7 });
    expect(matchesBankFilter(lastWeek, week, undefined, NOW)).toBe(true);
    expect(matchesBankFilter(lastMonth, week, undefined, NOW)).toBe(false);

    expect(matchesBankFilter(lastMonth, filter({ addedWithinDays: 30 }), undefined, NOW)).toBe(true);
  });

  it('filters by mastery, treating no review state as "new"', () => {
    const q = question({ id: 'q1' });
    expect(matchesBankFilter(q, filter({ mastery: ['new'] }), undefined, NOW)).toBe(true);
    expect(matchesBankFilter(q, filter({ mastery: ['solid'] }), undefined, NOW)).toBe(false);
  });

  it('shows only reported questions when asked', () => {
    const flagged = question({ id: 'q1', flagged: { reason: 'wrong', at: NOW } });
    const clean = question({ id: 'q2' });
    const reported = filter({ flaggedOnly: true });
    expect(matchesBankFilter(flagged, reported, undefined, NOW)).toBe(true);
    expect(matchesBankFilter(clean, reported, undefined, NOW)).toBe(false);
  });

  it('searches the prompt, case-insensitively', () => {
    const q = question({ id: 'q1', prompt: 'What was the Whig party?' });
    expect(matchesBankFilter(q, filter({ search: 'whig' }), undefined, NOW)).toBe(true);
    expect(matchesBankFilter(q, filter({ search: '  WHIG ' }), undefined, NOW)).toBe(true);
    expect(matchesBankFilter(q, filter({ search: 'tory' }), undefined, NOW)).toBe(false);
  });
});

describe('sortQuestions', () => {
  const oldest = question({ id: 'q1', addedAt: NOW - 10 * DAY, prompt: 'Charlie' });
  const middle = question({ id: 'q2', addedAt: NOW - 5 * DAY, prompt: 'Alpha' });
  const newest = question({ id: 'q3', addedAt: NOW, prompt: 'Bravo' });

  it('sorts newest and oldest by when a question entered the bank', () => {
    expect(sortQuestions([oldest, middle, newest], 'newest', {}).map((q) => q.id)).toEqual(['q3', 'q2', 'q1']);
    expect(sortQuestions([newest, middle, oldest], 'oldest', {}).map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('breaks addedAt ties by prompt, so one run lists stably', () => {
    const a = question({ id: 'a', addedAt: NOW, prompt: 'Zulu' });
    const b = question({ id: 'b', addedAt: NOW, prompt: 'Alpha' });
    expect(sortQuestions([a, b], 'newest', {}).map((q) => q.prompt)).toEqual(['Alpha', 'Zulu']);
  });

  it('sorts alphabetically by prompt', () => {
    expect(sortQuestions([oldest, middle, newest], 'a-z', {}).map((q) => q.prompt)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });

  it('puts struggling questions first, then unseen, then known', () => {
    /*
      The ranking under test: shaky before learning before new before familiar
      before solid — a question you keep missing needs you more than one you
      have never met.
    */
    const states: Record<string, ReviewState> = {
      // Repeated lapses without a streak: shaky.
      q1: review({ questionId: 'q1', lapses: 3, streak: 0, reps: 5, lastOutcome: 'incorrect' }),
      // Solid: long interval, long streak.
      q2: review({ questionId: 'q2', intervalDays: 40, streak: 6, reps: 8 }),
      // q3 has no state at all: new.
    };
    const ids = sortQuestions([middle, oldest, newest], 'weakest', states).map((q) => q.id);
    expect(ids[0]).toBe('q1');
    expect(ids[ids.length - 1]).toBe('q2');
  });

  it('never mutates its input', () => {
    const input = [newest, oldest];
    sortQuestions(input, 'oldest', {});
    expect(input.map((q) => q.id)).toEqual(['q3', 'q1']);
  });
});

describe('applyBankFilter and the active count', () => {
  it('filters then sorts in one pass', () => {
    const questions = [
      question({ id: 'q1', addedAt: NOW - 40 * DAY, topics: ['history'] }),
      question({ id: 'q2', addedAt: NOW - 2 * DAY, topics: ['history'] }),
      question({ id: 'q3', addedAt: NOW, topics: ['biology'] }),
    ];
    const result = applyBankFilter(
      questions,
      filter({ topics: ['history'], addedWithinDays: 7, sort: 'oldest' }),
      {},
      NOW,
    );
    expect(result.map((q) => q.id)).toEqual(['q2']);
  });

  it('counts selections, not filter kinds, in the badge', () => {
    expect(countActiveFilters(emptyBankFilter())).toBe(0);
    expect(
      countActiveFilters(
        filter({ topics: ['a', 'b'], formats: ['true-false'], addedWithinDays: 7, flaggedOnly: true }),
      ),
    ).toBe(5);
    // Search and sort are visible controls, not hidden constraints.
    expect(countActiveFilters(filter({ search: 'whig', sort: 'a-z' }))).toBe(0);
  });
});
