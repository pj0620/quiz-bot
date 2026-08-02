process.env.TZ = 'America/New_York';

import { daysBetween } from '../../lib/day';
import type { Outcome, ReviewState } from '../types';
import {
  SRS,
  daysUntilDue,
  isDue,
  isLeech,
  isNew,
  isValidReviewState,
  recordReview,
} from './schedule';

const NOW = new Date(2026, 4, 10, 12, 0, 0).getTime();
const QID = 'q-stable';

/** Answers a question `count` times with the same outcome. */
function answerRepeatedly(count: number, outcome: Outcome, start?: ReviewState): ReviewState {
  let state = start;
  for (let i = 0; i < count; i += 1) {
    state = recordReview(state, QID, outcome, NOW);
  }
  return state as ReviewState;
}

describe('first answers', () => {
  it('treats undefined state as new', () => {
    expect(isNew(undefined)).toBe(true);
    expect(isNew(recordReview(undefined, QID, 'correct', NOW))).toBe(false);
  });

  it('schedules a first correct answer one day out', () => {
    const state = recordReview(undefined, QID, 'correct', NOW);
    expect(daysBetween(NOW, state.dueAt)).toBe(SRS.firstIntervalDays);
    expect(state.reps).toBe(1);
    expect(state.streak).toBe(1);
    expect(state.lapses).toBe(0);
  });

  it('uses the fixed second interval before ease starts multiplying', () => {
    const state = answerRepeatedly(2, 'correct');
    expect(daysBetween(NOW, state.dueAt)).toBe(SRS.secondIntervalDays);
  });

  it('grows intervals after the fixed steps', () => {
    const third = answerRepeatedly(3, 'correct');
    expect(third.intervalDays).toBeGreaterThan(SRS.secondIntervalDays);
    const fourth = recordReview(third, QID, 'correct', NOW);
    expect(fourth.intervalDays).toBeGreaterThan(third.intervalDays);
  });
});

describe('ease', () => {
  it('rises on correct and falls on incorrect', () => {
    const correct = recordReview(undefined, QID, 'correct', NOW);
    expect(correct.ease).toBeCloseTo(SRS.initialEase + SRS.easeOnCorrect);

    const incorrect = recordReview(undefined, QID, 'incorrect', NOW);
    expect(incorrect.ease).toBeCloseTo(SRS.initialEase + SRS.easeOnIncorrect);
  });

  it('clamps at the floor no matter how many failures', () => {
    const state = answerRepeatedly(40, 'incorrect');
    expect(state.ease).toBe(SRS.minEase);
  });

  it('clamps at the ceiling no matter how many successes', () => {
    const state = answerRepeatedly(40, 'correct');
    expect(state.ease).toBe(SRS.maxEase);
  });

  it('drops ease on a partial answer', () => {
    const state = recordReview(undefined, QID, 'partial', NOW);
    expect(state.ease).toBeLessThan(SRS.initialEase);
  });
});

describe('lapses', () => {
  it('resets the streak and pulls the interval back in', () => {
    const grown = answerRepeatedly(4, 'correct');
    expect(grown.intervalDays).toBeGreaterThan(3);

    const lapsed = recordReview(grown, QID, 'incorrect', NOW);
    expect(lapsed.streak).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(daysBetween(NOW, lapsed.dueAt)).toBe(SRS.lapseIntervalDays);
  });

  it('does not reset all the way to zero — a lapse is not amnesia', () => {
    const lapsed = recordReview(answerRepeatedly(4, 'correct'), QID, 'incorrect', NOW);
    expect(lapsed.intervalDays).toBeGreaterThan(0);
    expect(lapsed.reps).toBeGreaterThan(0);
  });

  it('keeps a partial answer scheduled sooner than a correct one', () => {
    const base = answerRepeatedly(3, 'correct');
    const afterPartial = recordReview(base, QID, 'partial', NOW);
    const afterCorrect = recordReview(base, QID, 'correct', NOW);
    expect(afterPartial.intervalDays).toBeLessThan(afterCorrect.intervalDays);
  });
});

describe('leeches', () => {
  it('fires exactly at the threshold, not before', () => {
    const justUnder = answerRepeatedly(SRS.leechThreshold - 1, 'incorrect');
    expect(justUnder.lapses).toBe(SRS.leechThreshold - 1);
    expect(isLeech(justUnder)).toBe(false);

    const atThreshold = recordReview(justUnder, QID, 'incorrect', NOW);
    expect(atThreshold.lapses).toBe(SRS.leechThreshold);
    expect(isLeech(atThreshold)).toBe(true);
  });

  it('treats undefined state as not a leech', () => {
    expect(isLeech(undefined)).toBe(false);
  });
});

describe('interval cap', () => {
  it('never exceeds the maximum however long the streak', () => {
    let state = recordReview(undefined, QID, 'correct', NOW);
    for (let i = 0; i < 60; i += 1) {
      state = recordReview(state, QID, 'correct', NOW);
      expect(state.intervalDays).toBeLessThanOrEqual(SRS.maxIntervalDays * (1 + SRS.fuzzFactor));
    }
    expect(state.intervalDays).toBeGreaterThan(100);
  });
});

describe('fuzz', () => {
  it('is deterministic for a given question id', () => {
    const a = recordReview(answerRepeatedly(4, 'correct'), QID, 'correct', NOW);
    const b = recordReview(answerRepeatedly(4, 'correct'), QID, 'correct', NOW);
    expect(a.intervalDays).toBe(b.intervalDays);
    expect(a.dueAt).toBe(b.dueAt);
  });

  it('spreads different questions so they do not all come due together', () => {
    const base = answerRepeatedly(4, 'correct');
    const intervals = new Set(
      ['q-a', 'q-b', 'q-c', 'q-d', 'q-e', 'q-f'].map(
        (id) => recordReview(base, id, 'correct', NOW).intervalDays,
      ),
    );
    expect(intervals.size).toBeGreaterThan(1);
  });

  it('leaves short intervals alone so a lapse is always tomorrow', () => {
    const lapsed = recordReview(answerRepeatedly(4, 'correct'), QID, 'incorrect', NOW);
    expect(lapsed.intervalDays).toBe(SRS.lapseIntervalDays);
  });
});

describe('isDue', () => {
  const state = recordReview(undefined, QID, 'correct', NOW);

  it('is not due before the due date', () => {
    expect(isDue(state, state.dueAt - 1)).toBe(false);
  });

  /** Boundary: due dates snap to midnight, so the whole day counts as due. */
  it('is due at exactly the due timestamp', () => {
    expect(isDue(state, state.dueAt)).toBe(true);
  });

  it('is due after the due date', () => {
    expect(isDue(state, state.dueAt + 86_400_000)).toBe(true);
  });

  it('reports a new question as not due — new is a separate concept', () => {
    expect(isDue(undefined, NOW)).toBe(false);
  });

  it('lands due dates on a local midnight boundary', () => {
    expect(new Date(state.dueAt).getHours()).toBe(0);
  });
});

describe('daysUntilDue', () => {
  it('is positive ahead of the due date and negative when overdue', () => {
    const state = recordReview(undefined, QID, 'correct', NOW);
    expect(daysUntilDue(state, NOW)).toBe(1);
    expect(daysUntilDue(state, state.dueAt + 3 * 86_400_000)).toBe(-3);
  });

  it('sorts new questions last for due-first ordering', () => {
    expect(daysUntilDue(undefined, NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('isValidReviewState', () => {
  const valid = recordReview(undefined, QID, 'correct', NOW);

  it('accepts a real state', () => {
    expect(isValidReviewState(valid)).toBe(true);
  });

  it('rejects junk and missing fields', () => {
    expect(isValidReviewState(null)).toBe(false);
    expect(isValidReviewState({})).toBe(false);
    expect(isValidReviewState({ ...valid, questionId: '' })).toBe(false);
    expect(isValidReviewState({ ...valid, dueAt: 'soon' })).toBe(false);
  });

  it('rejects non-finite numbers that would poison scheduling', () => {
    expect(isValidReviewState({ ...valid, ease: Number.NaN })).toBe(false);
    expect(isValidReviewState({ ...valid, intervalDays: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
