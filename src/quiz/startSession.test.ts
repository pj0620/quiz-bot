jest.mock('../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { calendarStore } from './calendar/preferences';
import { resetCalendarCache, resolveSessionCalendar } from './calendar/resolve';
import { CALENDAR_SOURCE_ID, CALENDAR_TOPIC } from './calendar/types';
import { geographyStore } from './geography/preferences';
import { resetGeographyCache, resolveSessionGeography } from './geography/resolve';
import { GEOGRAPHY_SOURCE_ID, GEOGRAPHY_TOPIC } from './geography/types';
import { startAdhocSession, startQuizSession } from './startSession';
import { bankStore, reviewStore, sessionsStore } from './store';
import type { Quiz } from './types';

/*
  Where the derived catalog meets the rest of the app.

  The unit tests either side of this one prove the catalog derives correctly and
  resolves back exactly. This proves the two are actually WIRED: that enabling a
  subject puts its questions in front of the reader, that leaving it off changes
  nothing, and — the one that would be silently broken — that the questions a
  session is created with are the same ones it can resolve afterwards.
*/

const NOW = 1_760_000_000_000;

const geographyQuiz: Quiz = {
  id: 'builtin:geography',
  name: 'Geography',
  icon: 'globe-outline',
  builtin: true,
  createdAt: 0,
  rule: { size: 10, mix: 'balanced', topics: [GEOGRAPHY_TOPIC] },
};

beforeEach(() => {
  bankStore.set({ questions: [] });
  reviewStore.set({ states: {} });
  sessionsStore.set({ sessions: [] });
  geographyStore.set({ subjects: [] });
  resetGeographyCache();
  calendarStore.set({ subjects: [] });
  resetCalendarCache();
});

describe('geography in a quiz session', () => {
  it('draws nothing while every subject is switched off', () => {
    // The bank is empty and nothing is enabled, so there is genuinely nothing
    // to ask — the built-in quiz exists but stays inert until opted into.
    expect(startQuizSession(geographyQuiz, NOW)).toBeNull();
  });

  it('fills a session once a subject is switched on, with no bank at all', () => {
    geographyStore.set({ subjects: ['us-states'] });

    const result = startQuizSession(geographyQuiz, NOW);

    expect(result).not.toBeNull();
    expect(result!.session.items).toHaveLength(geographyQuiz.rule.size);
  });

  it('creates a session whose questions it can resolve again afterwards', () => {
    /*
      The single most important assertion in this file.

      Selection derives the catalog with one seed and clock; resolution rebuilds
      it later from what the SESSION stored. If those two ever drift apart the
      failure is silent and total — the player finds nothing for its ids and
      shows an empty screen where a half-finished quiz used to be.
    */
    geographyStore.set({ subjects: ['us-states', 'continents'] });

    const { session } = startQuizSession(geographyQuiz, NOW)!;
    const resolved = resolveSessionGeography(session);

    expect(resolved).toHaveLength(session.items.length);
    expect(resolved.map((question) => question.id).sort()).toEqual(
      session.items.map((item) => item.questionId).sort(),
    );
  });

  it('honours the subject toggle, not just the presence of geography', () => {
    geographyStore.set({ subjects: ['continents'] });

    const { session } = startQuizSession(geographyQuiz, NOW)!;

    for (const question of resolveSessionGeography(session)) {
      expect(question.topics).toContain('continents');
      expect(question.topics).not.toContain('us-states');
    }
  });

  it('leaves an unrelated quiz alone when geography is off', () => {
    const notesQuiz: Quiz = {
      ...geographyQuiz,
      id: 'q-notes',
      rule: { size: 5, mix: 'balanced' },
    };

    expect(startQuizSession(notesQuiz, NOW)).toBeNull();
  });

  it('mixes into a quiz that does not mention geography once enabled', () => {
    /*
      What the settings toggle actually promises: enabled subjects join the
      normal pool, so an unfiltered quiz — the Daily quiz — can draw them.
    */
    geographyStore.set({ subjects: ['us-states'] });
    const daily: Quiz = { ...geographyQuiz, id: 'builtin:daily', rule: { size: 5, mix: 'balanced' } };

    const { session } = startQuizSession(daily, NOW)!;

    expect(session.items.length).toBeGreaterThan(0);
    expect(resolveSessionGeography(session).length).toBeGreaterThan(0);
  });
});

describe('geography in an ad-hoc session', () => {
  it('rebuilds derived questions that are not in the bank', () => {
    // "Review what I missed" hands back ids from a finished session. For
    // geography there is nothing in the bank to look them up in.
    geographyStore.set({ subjects: ['us-states'] });
    const { session } = startQuizSession(geographyQuiz, NOW)!;
    const missed = session.items.slice(0, 3).map((item) => item.questionId);

    const result = startAdhocSession(missed, 'Missed questions', NOW + 1000);

    expect(result).not.toBeNull();
    expect(result!.session.items.map((item) => item.questionId)).toEqual(missed);
  });

  it('rebuilds them even after the subject has been switched off', () => {
    geographyStore.set({ subjects: ['europe'] });
    const { session } = startQuizSession(geographyQuiz, NOW)!;
    const ids = session.items.slice(0, 2).map((item) => item.questionId);

    geographyStore.set({ subjects: [] });

    // The preference governs what NEW sessions draw on. It must not make the
    // reader's own missed questions unreviewable.
    expect(startAdhocSession(ids, 'Missed questions', NOW + 1000)).not.toBeNull();
  });

  it('resolves its own session afterwards, exactly as a quiz session does', () => {
    geographyStore.set({ subjects: ['us-states'] });
    const first = startQuizSession(geographyQuiz, NOW)!;
    const ids = first.session.items.slice(0, 3).map((item) => item.questionId);

    const { session } = startAdhocSession(ids, 'Missed questions', NOW + 1000)!;

    expect(resolveSessionGeography(session).map((question) => question.id).sort()).toEqual(
      [...ids].sort(),
    );
  });
});

describe('calendar in a session', () => {
  /*
    The calendar catalog rides the same seams geography proved out above, so
    this block checks the WIRING is actually shared rather than re-proving the
    seams: on/off, round-trip resolution, and staying out of the bank.
  */
  const calendarQuiz: Quiz = {
    id: 'builtin:calendar',
    name: 'Calendar',
    icon: 'calendar-outline',
    builtin: true,
    createdAt: 0,
    rule: { size: 10, mix: 'balanced', topics: [CALENDAR_TOPIC] },
  };

  it('draws nothing while every subject is switched off', () => {
    expect(startQuizSession(calendarQuiz, NOW)).toBeNull();
  });

  it('creates a session whose questions it can resolve again afterwards', () => {
    calendarStore.set({ subjects: ['months', 'holidays'] });

    const { session } = startQuizSession(calendarQuiz, NOW)!;
    const resolved = resolveSessionCalendar(session);

    expect(resolved).toHaveLength(session.items.length);
    expect(resolved.map((question) => question.id).sort()).toEqual(
      session.items.map((item) => item.questionId).sort(),
    );
    for (const question of resolved) {
      expect(question.sourceId).toBe(CALENDAR_SOURCE_ID);
    }
  });

  it('coexists with geography in one session without either shadowing the other', () => {
    geographyStore.set({ subjects: ['continents'] });
    calendarStore.set({ subjects: ['seasons'] });
    const daily: Quiz = { ...calendarQuiz, id: 'builtin:daily', rule: { size: 20, mix: 'balanced' } };

    const { session } = startQuizSession(daily, NOW)!;

    // Between them the two catalogs account for every item drawn.
    const resolvedIds = new Set(
      [...resolveSessionGeography(session), ...resolveSessionCalendar(session)].map(
        (question) => question.id,
      ),
    );
    expect(session.items.every((item) => resolvedIds.has(item.questionId))).toBe(true);
    expect(resolveSessionGeography(session).length).toBeGreaterThan(0);
    expect(resolveSessionCalendar(session).length).toBeGreaterThan(0);
  });

  it('rebuilds ad-hoc reviews even after the subject has been switched off', () => {
    calendarStore.set({ subjects: ['weekdays'] });
    const { session } = startQuizSession(calendarQuiz, NOW)!;
    const ids = session.items.slice(0, 2).map((item) => item.questionId);

    calendarStore.set({ subjects: [] });

    expect(startAdhocSession(ids, 'Missed questions', NOW + 1000)).not.toBeNull();
  });

  it('never writes any of them to the bank', () => {
    calendarStore.set({ subjects: ['months'] });
    startQuizSession(calendarQuiz, NOW);

    expect(bankStore.get().questions).toEqual([]);
  });
});

describe('what geography questions look like to the rest of the app', () => {
  it('carries the reserved source id, so nothing mistakes them for a note', () => {
    geographyStore.set({ subjects: ['us-states'] });
    const { session } = startQuizSession(geographyQuiz, NOW)!;

    for (const question of resolveSessionGeography(session)) {
      expect(question.sourceId).toBe(GEOGRAPHY_SOURCE_ID);
    }
  });

  it('never writes any of them to the bank', () => {
    // The whole point of deriving them. A catalog that leaked into the bank
    // would be evicted by `capBank`, wiped by `clearQuestionBank`, and counted
    // in every "how many questions do I have" figure in the app.
    geographyStore.set({ subjects: ['us-states'] });
    startQuizSession(geographyQuiz, NOW);

    expect(bankStore.get().questions).toEqual([]);
  });
});
