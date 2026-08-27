jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import {
  calendarStore,
  getEnabledCalendarSubjects,
  isCalendarSubjectEnabled,
  setCalendarSubjectEnabled,
} from './preferences';

beforeEach(() => {
  calendarStore.set({ subjects: [] });
});

describe('defaults', () => {
  it('starts with nothing enabled', () => {
    /*
      The single most consequential line in this module, exactly as it is for
      geography: the catalog is ~120 questions nobody asked for, and unioning
      it into selection by default would change what every existing quiz draws
      on the first launch after the update.
    */
    expect(getEnabledCalendarSubjects()).toEqual([]);
  });
});

describe('toggling', () => {
  it('enables and disables a subject', () => {
    setCalendarSubjectEnabled('months', true);
    expect(isCalendarSubjectEnabled('months')).toBe(true);

    setCalendarSubjectEnabled('months', false);
    expect(isCalendarSubjectEnabled('months')).toBe(false);
  });

  it('keeps subjects in canonical order however they were enabled', () => {
    // De-duplicated, canonical storage is what lets the derivation loop treat
    // the list as authoritative without sorting it first.
    setCalendarSubjectEnabled('holidays', true);
    setCalendarSubjectEnabled('months', true);

    expect(getEnabledCalendarSubjects()).toEqual(['months', 'holidays']);
  });

  it('is idempotent', () => {
    setCalendarSubjectEnabled('seasons', true);
    setCalendarSubjectEnabled('seasons', true);

    expect(getEnabledCalendarSubjects()).toEqual(['seasons']);
  });
});
