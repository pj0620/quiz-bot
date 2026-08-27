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
  geographyStore,
  getEnabledSubjects,
  isSubjectEnabled,
  setSubjectEnabled,
} from './preferences';

beforeEach(() => {
  geographyStore.set({ subjects: [] });
});

describe('defaults', () => {
  it('starts with nothing enabled', () => {
    /*
      The single most consequential line in this module. The catalog is ~300
      questions nobody asked for, and unioning it into selection by default
      would change what every existing quiz draws on the first launch after the
      update — the Daily quiz especially, since derived questions always sit
      inside its `addedWithinDays` window.
    */
    expect(getEnabledSubjects()).toEqual([]);
  });
});

describe('toggling', () => {
  it('enables and disables a subject', () => {
    setSubjectEnabled('us-states', true);
    expect(isSubjectEnabled('us-states')).toBe(true);

    setSubjectEnabled('us-states', false);
    expect(isSubjectEnabled('us-states')).toBe(false);
  });

  it('leaves the other subjects alone', () => {
    setSubjectEnabled('us-states', true);
    setSubjectEnabled('europe', true);
    setSubjectEnabled('us-states', false);

    expect(getEnabledSubjects()).toEqual(['europe']);
  });

  it('ignores enabling something already on', () => {
    setSubjectEnabled('europe', true);
    setSubjectEnabled('europe', true);

    // A repeat would derive that subject's questions twice, and two rows
    // sharing one id is a bank the selection engine cannot reason about.
    expect(getEnabledSubjects()).toEqual(['europe']);
  });

  it('ignores disabling something already off', () => {
    setSubjectEnabled('continents', false);
    expect(getEnabledSubjects()).toEqual([]);
  });

  it('keeps a stable order however they were switched on', () => {
    setSubjectEnabled('continents', true);
    setSubjectEnabled('us-states', true);

    // Declaration order, not click order: the derived catalog is concatenated
    // in this order, and a wobbling order would reshuffle it for no reason.
    expect(getEnabledSubjects()).toEqual(['us-states', 'continents']);
  });
});
