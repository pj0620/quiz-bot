jest.mock('../../lib/kv', () => ({
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { writeJson } from '../../lib/kv';
import { coverageKey, isValidCoverage, MAX_FAILURES, parseCoverage } from './coverage';
import {
  clearAllCoverage,
  clearCoverageForSource,
  getCoverage,
  getCoverageFor,
  recordCoverage,
  recordFailure,
} from './coverageStore';

const mockedWriteJson = writeJson as jest.MockedFunction<typeof writeJson>;

beforeEach(() => {
  clearAllCoverage();
  jest.clearAllMocks();
});

describe('coverageKey', () => {
  it('namespaces by source, because a path is only unique within one', () => {
    expect(coverageKey('src-1', 'a.md')).not.toBe(coverageKey('src-2', 'a.md'));
  });
});

describe('parseCoverage', () => {
  const valid = { sourceId: 's', path: 'a.md', generatedAt: 1, questionCount: 2 };

  it('accepts a well-formed ledger', () => {
    expect(parseCoverage({ 's:a.md': valid })).toEqual({ 's:a.md': valid });
  });

  it('drops a malformed row without discarding the rest', () => {
    // Losing one entry costs one duplicate generation; losing the ledger costs
    // re-reading the whole vault.
    const parsed = parseCoverage({ 's:a.md': valid, 's:b.md': { path: 'b.md' }, 's:c.md': null });
    expect(Object.keys(parsed)).toEqual(['s:a.md']);
  });

  it('returns an empty ledger for junk rather than throwing', () => {
    expect(parseCoverage(null)).toEqual({});
    expect(parseCoverage('nonsense')).toEqual({});
    expect(parseCoverage(undefined)).toEqual({});
  });

  it('validates the fields selection depends on', () => {
    expect(isValidCoverage(valid)).toBe(true);
    expect(isValidCoverage({ ...valid, generatedAt: 'yesterday' })).toBe(false);
    expect(isValidCoverage({ ...valid, questionCount: undefined })).toBe(false);
  });
});

describe('recordCoverage', () => {
  it('stores the hash that was generated from', () => {
    recordCoverage({ sourceId: 's', path: 'a.md', contentHash: 'sha-1', questionCount: 4, now: 100 });

    expect(getCoverageFor('s', 'a.md')).toEqual({
      sourceId: 's',
      path: 'a.md',
      contentHash: 'sha-1',
      generatedAt: 100,
      questionCount: 4,
    });
    expect(mockedWriteJson).toHaveBeenCalledWith('quizbot.coverage.v1', expect.any(Object));
  });

  it('clears a failure streak on success', () => {
    recordFailure({ sourceId: 's', path: 'a.md', message: 'bad json' });
    recordFailure({ sourceId: 's', path: 'a.md', message: 'bad json' });
    recordCoverage({ sourceId: 's', path: 'a.md', contentHash: 'sha-1', questionCount: 2, now: 100 });

    expect(getCoverageFor('s', 'a.md')?.failures).toBeUndefined();
  });
});

describe('recordFailure', () => {
  it('counts consecutive failures', () => {
    recordFailure({ sourceId: 's', path: 'a.md', message: 'first' });
    recordFailure({ sourceId: 's', path: 'a.md', message: 'second' });

    const entry = getCoverageFor('s', 'a.md');
    expect(entry?.failures).toBe(2);
    expect(entry?.lastError).toBe('second');
  });

  it('does not mark the note as covered', () => {
    /*
      The subtle one. Writing the hash on failure would mark the note done at a
      version that produced nothing, and selection would never look at it again.
    */
    recordFailure({ sourceId: 's', path: 'a.md', message: 'bad json' });

    const entry = getCoverageFor('s', 'a.md');
    expect(entry?.contentHash).toBeUndefined();
    expect(entry?.generatedAt).toBe(0);
  });

  it('keeps a prior success intact when a later run fails', () => {
    recordCoverage({ sourceId: 's', path: 'a.md', contentHash: 'sha-1', questionCount: 4, now: 100 });
    recordFailure({ sourceId: 's', path: 'a.md', message: 'rate limited' });

    const entry = getCoverageFor('s', 'a.md');
    expect(entry?.contentHash).toBe('sha-1');
    expect(entry?.generatedAt).toBe(100);
    expect(entry?.questionCount).toBe(4);
    expect(entry?.failures).toBe(1);
  });

  it('reaches the give-up threshold after MAX_FAILURES', () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      recordFailure({ sourceId: 's', path: 'a.md', message: 'bad json' });
    }
    expect(getCoverageFor('s', 'a.md')?.failures).toBe(MAX_FAILURES);
  });
});

describe('clearing', () => {
  it('removes only the disconnected source', () => {
    recordCoverage({ sourceId: 's1', path: 'a.md', questionCount: 1 });
    recordCoverage({ sourceId: 's2', path: 'b.md', questionCount: 1 });

    clearCoverageForSource('s1');

    expect(getCoverageFor('s1', 'a.md')).toBeUndefined();
    expect(getCoverageFor('s2', 'b.md')).toBeDefined();
  });

  it('does not write when nothing matched', () => {
    recordCoverage({ sourceId: 's2', path: 'b.md', questionCount: 1 });
    jest.clearAllMocks();

    clearCoverageForSource('s1');
    expect(mockedWriteJson).not.toHaveBeenCalled();
  });

  it('empties the whole ledger on reset', () => {
    recordCoverage({ sourceId: 's', path: 'a.md', questionCount: 1 });
    clearAllCoverage();
    expect(getCoverage()).toEqual({});
  });
});
