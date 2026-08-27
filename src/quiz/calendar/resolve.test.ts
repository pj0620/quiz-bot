import type { Session, SessionItem } from '../types';
import { calendarQuestionId, listCalendarQuestions } from './catalog';
import { resetCalendarCache, resolveCalendarQuestion, resolveSessionCalendar } from './resolve';
import { CALENDAR_SUBJECTS } from './types';

/*
  The round trip that makes a resumed session safe — the calendar twin of
  `geography/resolve.test.ts`. A session stores question IDS and nothing else;
  if the rebuild differs by so much as one distractor, the reader comes back
  to a question they never saw with a grade already recorded against it.
*/

const NOW = 1_760_000_000_000;
const SEED = 4242;

beforeEach(resetCalendarCache);

function sessionWith(items: SessionItem[], overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    quizName: 'Calendar',
    status: 'active',
    startedAt: NOW,
    seed: SEED,
    currentIndex: 0,
    items,
    ...overrides,
  };
}

describe('resolveCalendarQuestion', () => {
  it('rebuilds every derived question exactly, byte for byte', () => {
    const original = listCalendarQuestions(CALENDAR_SUBJECTS, SEED, NOW);

    for (const question of original) {
      expect(resolveCalendarQuestion(question.id, SEED, NOW)).toEqual(question);
    }
  });

  it('keeps the id but moves the options when the seed changes', () => {
    const id = calendarQuestionId('holidays', 'holiday-month', 'halloween');
    const optionSets = new Set<string>();

    for (let seed = 1; seed <= 12; seed += 1) {
      resetCalendarCache();
      const question = resolveCalendarQuestion(id, seed, NOW);
      if (question?.format !== 'multiple-choice') throw new Error('expected multiple choice');

      expect(question.id).toBe(id);
      optionSets.add(JSON.stringify(question.choices.map((choice) => choice.id).sort()));
    }

    expect(optionSets.size).toBeGreaterThan(1);
  });

  it('returns undefined for an id that is not derived', () => {
    expect(resolveCalendarQuestion('not-a-cal-id', SEED, NOW)).toBeUndefined();
  });
});

describe('resolveSessionCalendar', () => {
  it('rebuilds from the session alone, using its own persisted seed and clock', () => {
    const derived = listCalendarQuestions(['months'], SEED, NOW).slice(0, 3);
    const session = sessionWith(
      derived.map((question) => ({ questionId: question.id, wasNew: true })),
    );

    expect(resolveSessionCalendar(session)).toEqual(derived);
  });

  it('returns only what the session refers to, never the whole catalog', () => {
    const derived = listCalendarQuestions(['months'], SEED, NOW);
    const session = sessionWith([{ questionId: derived[0].id, wasNew: true }]);

    expect(resolveSessionCalendar(session)).toHaveLength(1);
  });

  it('resolves subjects the reader has switched OFF', () => {
    // The preference governs what new sessions DRAW ON, nothing else —
    // resolution always indexes every subject.
    const id = calendarQuestionId('weekdays', 'day-after', 'fri');
    expect(resolveCalendarQuestion(id, SEED, NOW)).toBeDefined();
  });
});
