process.env.TZ = 'America/New_York';

import { addDays } from '../../lib/day';
import { recordReview } from '../srs/schedule';
import type { Difficulty, MultipleChoiceQuestion, Question, QuizRule, ReviewState } from '../types';
import { countMatching, matchesRule } from './matchesRule';
import { describeAvailability, selectQuestions } from './select';

const NOW = new Date(2026, 4, 10, 12).getTime();

function q(
  id: string,
  overrides: Partial<MultipleChoiceQuestion> = {},
): MultipleChoiceQuestion {
  return {
    id,
    format: 'multiple-choice',
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['auth'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1' },
    addedAt: NOW,
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctChoiceId: 'a',
    ...overrides,
  };
}

const rule = (overrides: Partial<QuizRule> = {}): QuizRule => ({
  size: 10,
  mix: 'balanced',
  ...overrides,
});

/** A state that is due right now. */
function dueState(id: string): ReviewState {
  return { ...recordReview(undefined, id, 'correct', NOW), dueAt: NOW - 1000 };
}

/** A state answered correctly and not due for a while. */
function futureState(id: string): ReviewState {
  return { ...recordReview(undefined, id, 'correct', NOW), dueAt: addDays(NOW, 30) };
}

// ---------------------------------------------------------------------------

describe('matchesRule — filters', () => {
  it('matches everything when the rule has no filters', () => {
    expect(matchesRule(q('1'), rule(), undefined, NOW)).toBe(true);
  });

  /** ANY, not ALL — requiring all topics would make multi-topic rules useless. */
  it('matches a question having ANY of the rule topics', () => {
    const question = q('1', { topics: ['auth', 'tokens'] });
    expect(matchesRule(question, rule({ topics: ['tokens'] }), undefined, NOW)).toBe(true);
    expect(matchesRule(question, rule({ topics: ['tokens', 'unrelated'] }), undefined, NOW)).toBe(true);
    expect(matchesRule(question, rule({ topics: ['unrelated'] }), undefined, NOW)).toBe(false);
  });

  it('treats an empty topics array as no constraint', () => {
    expect(matchesRule(q('1'), rule({ topics: [] }), undefined, NOW)).toBe(true);
  });

  /** Unconditional: a question the user declared broken never comes back. */
  it('always excludes flagged questions, even when they match every filter', () => {
    const flagged = q('1', { flagged: { reason: 'wrong', at: NOW } });
    expect(matchesRule(flagged, rule(), undefined, NOW)).toBe(false);
    expect(matchesRule(flagged, rule({ topics: ['auth'] }), undefined, NOW)).toBe(false);
  });

  it('filters by source, format, and difficulty', () => {
    expect(matchesRule(q('1'), rule({ sourceIds: ['other'] }), undefined, NOW)).toBe(false);
    expect(matchesRule(q('1'), rule({ sourceIds: ['src-1'] }), undefined, NOW)).toBe(true);
    expect(matchesRule(q('1'), rule({ formats: ['true-false'] }), undefined, NOW)).toBe(false);
    expect(matchesRule(q('1'), rule({ formats: ['multiple-choice'] }), undefined, NOW)).toBe(true);

    const deep: Difficulty[] = ['deep'];
    expect(matchesRule(q('1'), rule({ difficulties: deep }), undefined, NOW)).toBe(false);
  });

  describe('addedWithinDays boundary', () => {
    it('includes something added today', () => {
      expect(matchesRule(q('1', { addedAt: NOW }), rule({ addedWithinDays: 2 }), undefined, NOW)).toBe(true);
    });

    /** The case that decides whether "last N days" feels right at a day boundary. */
    it('includes 23:59 yesterday when the window is 2 days', () => {
      const lateYesterday = new Date(2026, 4, 9, 23, 59).getTime();
      expect(
        matchesRule(q('1', { addedAt: lateYesterday }), rule({ addedWithinDays: 2 }), undefined, NOW),
      ).toBe(true);
    });

    it('excludes 23:59 two days ago when the window is 2 days', () => {
      const twoDaysBack = new Date(2026, 4, 8, 23, 59).getTime();
      expect(
        matchesRule(q('1', { addedAt: twoDaysBack }), rule({ addedWithinDays: 2 }), undefined, NOW),
      ).toBe(false);
    });
  });

  it('filters by mastery ceiling', () => {
    const solid = { ...recordReview(undefined, '1', 'correct', NOW), intervalDays: 30, streak: 5 };
    expect(matchesRule(q('1'), rule({ maxMastery: 'shaky' }), solid, NOW)).toBe(false);
    expect(matchesRule(q('1'), rule({ maxMastery: 'shaky' }), undefined, NOW)).toBe(true); // new
  });
});

describe('countMatching', () => {
  it('counts only matching, unflagged questions', () => {
    const bank = [
      q('1', { topics: ['auth'] }),
      q('2', { topics: ['other'] }),
      q('3', { topics: ['auth'], flagged: { reason: 'wrong', at: NOW } }),
    ];
    expect(countMatching(bank, rule({ topics: ['auth'] }), {}, NOW)).toBe(1);
    expect(countMatching(bank, rule(), {}, NOW)).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('selectQuestions — mix ratios', () => {
  const newBank = Array.from({ length: 20 }, (_, i) => q(`new-${i}`));
  const dueBank = Array.from({ length: 20 }, (_, i) => q(`due-${i}`));
  const bank = [...newBank, ...dueBank];
  const states = Object.fromEntries(dueBank.map((question) => [question.id, dueState(question.id)]));

  it('splits evenly when balanced', () => {
    const result = selectQuestions({ bank, reviewStates: states, rule: rule({ size: 10 }), now: NOW, seed: 1 });
    expect(result.counts.total).toBe(10);
    expect(result.counts.new).toBe(5);
    expect(result.counts.due).toBe(5);
    expect(result.shortfall).toBe(0);
  });

  it('takes only new questions when mix is new-only', () => {
    const result = selectQuestions({
      bank, reviewStates: states, rule: rule({ size: 10, mix: 'new-only' }), now: NOW, seed: 1,
    });
    expect(result.counts.new).toBe(10);
    expect(result.counts.due).toBe(0);
  });

  it('takes only due questions when mix is review-only', () => {
    const result = selectQuestions({
      bank, reviewStates: states, rule: rule({ size: 10, mix: 'review-only' }), now: NOW, seed: 1,
    });
    expect(result.counts.new).toBe(0);
    expect(result.counts.due).toBe(10);
  });
});

describe('selectQuestions — pool rebalancing', () => {
  /**
   * The fresh-install case. Balanced wants 5 new + 5 due, but nothing has ever
   * been answered — without rebalancing the user gets a half-length session.
   */
  it('fills from new when nothing is due yet', () => {
    const bank = Array.from({ length: 20 }, (_, i) => q(`n-${i}`));
    const result = selectQuestions({ bank, reviewStates: {}, rule: rule({ size: 10 }), now: NOW, seed: 1 });
    expect(result.counts.total).toBe(10);
    expect(result.counts.new).toBe(10);
    expect(result.shortfall).toBe(0);
  });

  it('fills from due when everything has been seen', () => {
    const bank = Array.from({ length: 20 }, (_, i) => q(`d-${i}`));
    const states = Object.fromEntries(bank.map((question) => [question.id, dueState(question.id)]));
    const result = selectQuestions({ bank, reviewStates: states, rule: rule({ size: 10 }), now: NOW, seed: 1 });
    expect(result.counts.total).toBe(10);
    expect(result.counts.due).toBe(10);
  });

  it('reports a shortfall rather than padding with off-rule questions', () => {
    const bank = [q('1', { topics: ['auth'] }), q('2', { topics: ['auth'] }), q('3', { topics: ['other'] })];
    const result = selectQuestions({
      bank, reviewStates: {}, rule: rule({ size: 10, topics: ['auth'] }), now: NOW, seed: 1,
    });
    expect(result.counts.total).toBe(2);
    expect(result.shortfall).toBe(8);
    expect(result.questions.every((question) => question.topics.includes('auth'))).toBe(true);
  });

  it('returns an empty result rather than throwing when nothing matches', () => {
    const result = selectQuestions({
      bank: [q('1')], reviewStates: {}, rule: rule({ topics: ['nope'] }), now: NOW, seed: 1,
    });
    expect(result.questions).toEqual([]);
    expect(result.shortfall).toBe(10);
  });

  it('handles size larger than the whole bank', () => {
    const bank = [q('1'), q('2')];
    const result = selectQuestions({ bank, reviewStates: {}, rule: rule({ size: 500 }), now: NOW, seed: 1 });
    expect(result.counts.total).toBe(2);
    expect(result.shortfall).toBe(498);
  });
});

describe('selectQuestions — exclusions', () => {
  it('skips not-yet-due questions', () => {
    const bank = [q('1')];
    const result = selectQuestions({
      bank, reviewStates: { '1': futureState('1') }, rule: rule(), now: NOW, seed: 1,
    });
    expect(result.questions).toEqual([]);
  });

  /** One impossible question must not fill every session forever. */
  it('skips leeches', () => {
    const bank = [q('1')];
    let state: ReviewState | undefined;
    for (let i = 0; i < 6; i += 1) state = recordReview(state, '1', 'incorrect', NOW);
    const leech = { ...(state as ReviewState), dueAt: NOW - 1000 };

    expect(leech.leech).toBe(true);
    const result = selectQuestions({ bank, reviewStates: { '1': leech }, rule: rule(), now: NOW, seed: 1 });
    expect(result.questions).toEqual([]);
  });

  it('honours the exclude list', () => {
    const bank = [q('1'), q('2'), q('3')];
    const result = selectQuestions({
      bank, reviewStates: {}, rule: rule(), now: NOW, seed: 1, exclude: ['1', '2'],
    });
    expect(result.questions.map((question) => question.id)).toEqual(['3']);
  });

  it('never returns a flagged question', () => {
    const bank = [q('1', { flagged: { reason: 'duplicate', at: NOW } }), q('2')];
    const result = selectQuestions({ bank, reviewStates: {}, rule: rule(), now: NOW, seed: 1 });
    expect(result.questions.map((question) => question.id)).toEqual(['2']);
  });
});

describe('selectQuestions — ordering and determinism', () => {
  it('prefers the most overdue when the due pool exceeds the quota', () => {
    const bank = Array.from({ length: 5 }, (_, i) => q(`d-${i}`));
    const states: Record<string, ReviewState> = {};
    bank.forEach((question, index) => {
      // d-0 is the most overdue.
      states[question.id] = { ...dueState(question.id), dueAt: NOW - (5 - index) * 86_400_000 };
    });

    const result = selectQuestions({
      bank, reviewStates: states, rule: rule({ size: 2, mix: 'review-only' }), now: NOW, seed: 1,
    });
    expect(result.questions.map((question) => question.id).sort()).toEqual(['d-0', 'd-1']);
  });

  /** A resumed session must not reshuffle its own questions. */
  it('is identical for the same seed', () => {
    const bank = Array.from({ length: 30 }, (_, i) => q(`n-${i}`));
    const once = selectQuestions({ bank, reviewStates: {}, rule: rule(), now: NOW, seed: 42 });
    const twice = selectQuestions({ bank, reviewStates: {}, rule: rule(), now: NOW, seed: 42 });
    expect(once.questions.map((question) => question.id)).toEqual(twice.questions.map((question) => question.id));
  });

  it('differs across seeds', () => {
    const bank = Array.from({ length: 30 }, (_, i) => q(`n-${i}`));
    const a = selectQuestions({ bank, reviewStates: {}, rule: rule(), now: NOW, seed: 1 });
    const b = selectQuestions({ bank, reviewStates: {}, rule: rule(), now: NOW, seed: 2 });
    expect(a.questions.map((question) => question.id)).not.toEqual(b.questions.map((question) => question.id));
  });

  it('never returns duplicates', () => {
    const bank = Array.from({ length: 30 }, (_, i) => q(`n-${i}`));
    const result = selectQuestions({ bank, reviewStates: {}, rule: rule({ size: 20 }), now: NOW, seed: 7 });
    expect(new Set(result.questions.map((question) => question.id)).size).toBe(result.questions.length);
  });

  it('interleaves due and new rather than front-loading reviews', () => {
    const newBank = Array.from({ length: 10 }, (_, i) => q(`new-${i}`));
    const dueBank = Array.from({ length: 10 }, (_, i) => q(`due-${i}`));
    const states = Object.fromEntries(dueBank.map((question) => [question.id, dueState(question.id)]));

    const result = selectQuestions({
      bank: [...newBank, ...dueBank], reviewStates: states, rule: rule({ size: 10 }), now: NOW, seed: 3,
    });
    const ids = result.questions.map((question) => question.id);
    const firstNewIndex = ids.findIndex((id) => id.startsWith('new-'));
    // If reviews were front-loaded, the first new question would sit at index 5.
    expect(firstNewIndex).toBeLessThan(5);
  });

  it('treats size zero as an empty session', () => {
    const result = selectQuestions({ bank: [q('1')], reviewStates: {}, rule: rule({ size: 0 }), now: NOW, seed: 1 });
    expect(result.questions).toEqual([]);
  });
});

describe('describeAvailability', () => {
  it('breaks the matching pool down by state', () => {
    const bank = [q('new1'), q('new2'), q('due1'), q('later')];
    const states = { due1: dueState('due1'), later: futureState('later') };

    expect(describeAvailability({ bank, reviewStates: states, rule: rule(), now: NOW })).toEqual({
      matching: 4,
      new: 2,
      due: 1,
      notYetDue: 1,
      leeches: 0,
    });
  });

  it('excludes flagged questions from the matching count', () => {
    const bank = [q('1'), q('2', { flagged: { reason: 'wrong', at: NOW } })];
    expect(describeAvailability({ bank, reviewStates: {}, rule: rule(), now: NOW }).matching).toBe(1);
  });
});
