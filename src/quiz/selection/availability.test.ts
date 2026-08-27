jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { listGeographyQuestions } from '../geography/catalog';
import { geographyStore } from '../geography/preferences';
import { GEOGRAPHY_TOPIC } from '../geography/types';
import { startQuizSession } from '../startSession';
import { bankStore, reviewStore, sessionsStore } from '../store';
import type { Quiz, QuizRule } from '../types';
import { describeAvailability } from './select';

/*
  What the quiz screen counts must match what pressing Start actually draws.

  This is a regression test for a shipped bug, and the shape of it is worth
  remembering. Selection was wired to include the derived geography catalog, so
  `startQuizSession` worked perfectly — but every screen that decides whether a
  quiz has anything to offer counted the BANK, where geography by design never
  appears. The count came back zero, the screen disabled its own Start button,
  and the working code behind it was unreachable.

  Nothing failed. No test broke, no type complained, and the feature was simply
  impossible to use. So what is pinned here is the AGREEMENT between the two:
  whatever the screens count, a session started from the same rule must be able
  to draw.
*/

const NOW = 1_760_000_000_000;

const geographyRule: QuizRule = { size: 10, mix: 'balanced', topics: [GEOGRAPHY_TOPIC] };

const geographyQuiz: Quiz = {
  id: 'builtin:geography',
  name: 'Geography',
  icon: 'globe-outline',
  builtin: true,
  createdAt: 0,
  rule: geographyRule,
};

/** What the screens do: count a rule against everything a quiz may ask. */
function countFor(subjects: Parameters<typeof listGeographyQuestions>[0]) {
  const bank = [...bankStore.get().questions, ...listGeographyQuestions(subjects, 0, NOW)];
  return describeAvailability({
    bank,
    reviewStates: reviewStore.get().states,
    rule: geographyRule,
    now: NOW,
  });
}

beforeEach(() => {
  bankStore.set({ questions: [] });
  reviewStore.set({ states: {} });
  sessionsStore.set({ sessions: [] });
});

describe('what the quiz screen counts', () => {
  it('counts nothing while every subject is off', () => {
    expect(countFor([]).matching).toBe(0);
  });

  it('counts the derived catalog once a subject is on', () => {
    // Counting the bank here returns 0 — that was the bug.
    expect(countFor(['us-states']).matching).toBeGreaterThan(0);
  });

  it('counts them as available to draw, not merely as matching', () => {
    // `matching` alone would still leave Start disabled if they all landed in
    // "resting": the screen needs them to be genuinely askable.
    const availability = countFor(['us-states']);
    expect(availability.new).toBeGreaterThan(0);
    expect(availability.notYetDue).toBe(0);
  });

  it('grows when a second subject is switched on', () => {
    const one = countFor(['us-states']).matching;
    const two = countFor(['us-states', 'europe']).matching;
    expect(two).toBeGreaterThan(one);
  });
});

describe('the count agrees with what Start draws', () => {
  it('offers a session whenever the screen shows a non-zero count', () => {
    geographyStore.set({ subjects: ['us-states'] });

    expect(countFor(['us-states']).matching).toBeGreaterThan(0);
    expect(startQuizSession(geographyQuiz, NOW)).not.toBeNull();
  });

  it('shows nothing to start exactly when there is nothing to start', () => {
    geographyStore.set({ subjects: [] });

    expect(countFor([]).matching).toBe(0);
    expect(startQuizSession(geographyQuiz, NOW)).toBeNull();
  });

  it('never promises more than a session can deliver', () => {
    geographyStore.set({ subjects: ['continents'] });

    // Continents is the small subject — few enough that the rule's size of 10
    // may not be filled, which is exactly when an over-promise would show.
    const promised = Math.min(geographyRule.size, countFor(['continents']).matching);
    const { session } = startQuizSession(geographyQuiz, NOW)!;

    expect(session.items.length).toBe(promised);
  });
});
