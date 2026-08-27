import type { Session, SessionItem } from '../types';
import { geographyQuestionId, listGeographyQuestions } from './catalog';
import { resetGeographyCache, resolveGeographyQuestion, resolveSessionGeography } from './resolve';
import { GEOGRAPHY_SUBJECTS } from './types';

/*
  The round trip that makes a resumed session safe.

  A session stores question IDS and nothing else. For everything in the bank
  that is fine; for geography the question has to be rebuilt from the id, and if
  the rebuild differs by so much as one distractor then the reader comes back to
  a question they never saw — with a grade already recorded against options no
  longer on screen. These tests are the guarantee that it does not.
*/

const NOW = 1_760_000_000_000;
const SEED = 4242;

beforeEach(resetGeographyCache);

function sessionWith(items: SessionItem[], overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    quizName: 'Geography',
    status: 'active',
    startedAt: NOW,
    seed: SEED,
    currentIndex: 0,
    items,
    ...overrides,
  };
}

describe('resolveGeographyQuestion', () => {
  it('rebuilds every derived question exactly, byte for byte', () => {
    const original = listGeographyQuestions(GEOGRAPHY_SUBJECTS, SEED, NOW);

    for (const question of original) {
      expect(resolveGeographyQuestion(question.id, SEED, NOW)).toEqual(question);
    }
  });

  it('rebuilds the same OPTIONS, not merely the same question', () => {
    const id = geographyQuestionId('us-states', 'shape-choice', 'us-tn');
    const first = resolveGeographyQuestion(id, SEED, NOW);
    resetGeographyCache();
    const second = resolveGeographyQuestion(id, SEED, NOW);

    if (first?.format !== 'multiple-choice' || second?.format !== 'multiple-choice') {
      throw new Error('expected a multiple-choice question');
    }
    // Survives the memo being dropped, which is what a relaunch does.
    expect(second.choices).toEqual(first.choices);
  });

  it('keeps the id but moves the options when the seed changes', () => {
    /*
      Both halves of the contract in one test. Scanned across seeds rather than
      compared across two, for the reason `catalog.test.ts` gives: two seeds may
      legitimately agree, but a run of them that never disagrees means the seed
      is not reaching the distractors at all.
    */
    const id = geographyQuestionId('us-states', 'shape-choice', 'us-tn');
    const optionSets = new Set<string>();

    for (let seed = 1; seed <= 12; seed += 1) {
      resetGeographyCache();
      const question = resolveGeographyQuestion(id, seed, NOW);
      if (question?.format !== 'multiple-choice') throw new Error('expected multiple choice');

      expect(question.id).toBe(id);
      optionSets.add(JSON.stringify(question.choices.map((choice) => choice.id).sort()));
    }

    expect(optionSets.size).toBeGreaterThan(1);
  });

  it('returns undefined for an id that is not derived', () => {
    expect(resolveGeographyQuestion('not-a-geo-id', SEED, NOW)).toBeUndefined();
  });

  it('resolves subjects the reader has switched OFF', () => {
    /*
      The preference governs what new sessions DRAW ON, nothing else. Someone
      who turns Europe off midway through a Europe quiz still has to be able to
      finish the session they are sitting.
    */
    const id = geographyQuestionId('europe', 'locate', 'eu-fr');
    expect(resolveGeographyQuestion(id, SEED, NOW)).toBeDefined();
  });
});

describe('resolveSessionGeography', () => {
  it('rebuilds from the session alone, using its own persisted seed and clock', () => {
    const derived = listGeographyQuestions(['us-states'], SEED, NOW).slice(0, 3);
    const session = sessionWith(
      derived.map((question) => ({ questionId: question.id, wasNew: true })),
    );

    expect(resolveSessionGeography(session)).toEqual(derived);
  });

  it('returns only what the session refers to, never the whole catalog', () => {
    const derived = listGeographyQuestions(['us-states'], SEED, NOW);
    const session = sessionWith([{ questionId: derived[0].id, wasNew: true }]);

    // A results screen concatenates this with the bank; leaking 300 questions
    // into it would be visible immediately.
    expect(resolveSessionGeography(session)).toHaveLength(1);
  });

  it('ignores bank ids mixed in with derived ones', () => {
    const derived = listGeographyQuestions(['us-states'], SEED, NOW)[0];
    const session = sessionWith([
      { questionId: 'note-question-1', wasNew: false },
      { questionId: derived.id, wasNew: true },
    ]);

    expect(resolveSessionGeography(session)).toEqual([derived]);
  });

  it('rebuilds a session whose clock differs from the current one', () => {
    // The point of keying on `startedAt`: a session resumed days later still
    // rebuilds the questions it was created with.
    const then = NOW - 5 * 24 * 3600 * 1000;
    const derived = listGeographyQuestions(['continents'], SEED, then);
    const session = sessionWith(
      derived.map((question) => ({ questionId: question.id, wasNew: true })),
      { startedAt: then },
    );

    expect(resolveSessionGeography(session)).toEqual(derived);
  });

  it('does not confuse two sessions started at the same moment with different seeds', () => {
    const a = sessionWith(
      listGeographyQuestions(['us-states'], 1, NOW)
        .slice(0, 2)
        .map((question) => ({ questionId: question.id, wasNew: true })),
      { seed: 1 },
    );
    const b = sessionWith(
      listGeographyQuestions(['us-states'], 2, NOW)
        .slice(0, 2)
        .map((question) => ({ questionId: question.id, wasNew: true })),
      { seed: 2 },
    );

    // Interleaved on purpose: the cache holds ONE entry, so alternating between
    // two sessions is exactly the access pattern that would expose a stale memo.
    const first = resolveSessionGeography(a);
    const second = resolveSessionGeography(b);
    const firstAgain = resolveSessionGeography(a);

    expect(firstAgain).toEqual(first);
    expect(second).not.toEqual(first);
  });
});
