/**
 * Deterministic randomness.
 *
 * Everything here is seeded on purpose: question ids must be stable across app
 * versions, and a resumed quiz session must not reshuffle its questions under
 * the user. Nothing in this file may call Math.random().
 */

/**
 * FNV-1a. Used to derive question ids and shuffle seeds from strings.
 *
 * The exact output is pinned by tests — changing this function changes every
 * question id, which would orphan every stored review state.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    // FNV prime, via shifts to stay in 32-bit int range under Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned so callers never see a negative seed.
  return hash >>> 0;
}

/** mulberry32 — small, fast, good enough distribution for shuffling. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded generator. Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = items.slice();
  const random = createRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = result[i];
    result[i] = result[j];
    result[j] = swap;
  }
  return result;
}

/** Deterministic integer in [min, max]. */
export function seededInt(seed: number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(createRandom(seed)() * (max - min + 1));
}

/** Deterministic pick. Returns undefined only for an empty array. */
export function seededPick<T>(items: readonly T[], seed: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[seededInt(seed, 0, items.length - 1)];
}
