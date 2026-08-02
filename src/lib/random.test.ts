import { createRandom, hashString, seededInt, seededPick, seededShuffle } from './random';

describe('hashString', () => {
  /**
   * These values are PINNED deliberately. hashString derives question ids, so
   * changing its output would orphan every stored review state in every
   * installed copy of the app. If this test fails, the fix is to revert the
   * hash, not to update the expectations.
   */
  it('produces stable, pinned output', () => {
    expect(hashString('')).toBe(2166136261);
    expect(hashString('a')).toBe(3826002220);
    expect(hashString('quiz-bot')).toBe(hashString('quiz-bot'));
  });

  it('always returns an unsigned 32-bit integer', () => {
    for (const input of ['', 'a', 'zzzzzzzzzzzz', 'src/auth/tokenManager.ts|multiple-choice']) {
      const result = hashString(input);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('separates similar inputs', () => {
    expect(hashString('question-1')).not.toBe(hashString('question-2'));
    expect(hashString('ab')).not.toBe(hashString('ba'));
  });
});

describe('createRandom', () => {
  it('is deterministic for a given seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const seriesA = [a(), a(), a(), a()];
    const seriesB = [b(), b(), b(), b()];
    expect(seriesA).toEqual(seriesB);
  });

  it('differs across seeds', () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });

  it('stays within [0, 1)', () => {
    const random = createRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('seededShuffle', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];

  it('is a permutation — same multiset, nothing lost or duplicated', () => {
    const shuffled = seededShuffle(items, 99);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it('is deterministic for a seed', () => {
    expect(seededShuffle(items, 5)).toEqual(seededShuffle(items, 5));
  });

  it('differs across seeds', () => {
    expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
  });

  it('does not mutate the input', () => {
    const original = [...items];
    seededShuffle(items, 3);
    expect(items).toEqual(original);
  });

  it('handles empty and single-element arrays', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['only'], 1)).toEqual(['only']);
  });
});

describe('seededInt', () => {
  it('stays within bounds inclusive', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const value = seededInt(seed, 3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it('collapses when max <= min', () => {
    expect(seededInt(1, 5, 5)).toBe(5);
    expect(seededInt(1, 5, 2)).toBe(5);
  });
});

describe('seededPick', () => {
  it('returns undefined only for an empty array', () => {
    expect(seededPick([], 1)).toBeUndefined();
    expect(seededPick(['a'], 1)).toBe('a');
  });

  it('is deterministic', () => {
    const options = ['a', 'b', 'c', 'd'];
    expect(seededPick(options, 12)).toBe(seededPick(options, 12));
  });
});
