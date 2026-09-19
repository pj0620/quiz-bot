/**
 * Deciding, on the device, whether a typed answer names the expected thing.
 *
 * Three checks, cheapest first, and every one runs offline in well under a
 * millisecond. They exist so that the model is the LAST resort for marking a
 * written answer, not the first: someone who types "bull" for "Bull" should
 * not wait on a network round trip to be told they were right, and someone
 * with no signal should not be handed the self-grade buttons for an answer the
 * app could plainly see was correct.
 *
 *   1. `exact`   — the same text once case, punctuation, accents, spacing and a
 *                  leading article are ignored. "the Bull" is "bull".
 *   2. `fuzzy`   — a spelling slip away from the same text. Edit distance with
 *                  a budget that scales with length, so "Kentuky" is
 *                  "Kentucky" but "bul" is not "bull".
 *   3. `similar` — a bag-of-subwords vector for each side and the cosine
 *                  between them, in the style of fastText's character n-grams.
 *                  Catches reordered words and a longer slip than the fuzzy
 *                  budget allows ("automatic fast system" for "fast automatic
 *                  system"). There are no learned weights, so this measures
 *                  surface overlap, never meaning: "USSR" and "Soviet Union"
 *                  still need a model.
 *
 * Every check can only ever say YES. A miss here means nothing — the answer
 * goes on to the model, or to the reader — because none of these can tell a
 * wrong answer from a right one phrased differently. What they must never do
 * is say yes to a wrong answer, so three guards sit in front of the lenient
 * checks: the numbers on both sides must agree ("System 1" is not "System 2",
 * however alike they look), so must negation ("not a bull" is not "bull"), and
 * neither side may name the opposite half of a contrasting pair the other
 * names ("north korea" is not "south korea").
 */

/** How the answer was matched, and which expected text it matched. */
export type LocalMatch = {
  via: 'exact' | 'fuzzy' | 'similar';
  against: string;
};

/**
 * Below this cosine two texts are not the same answer.
 *
 * Tuned against near misses rather than hits: "Economic Strength" against
 * "Economic Weakness", "Homozygous" against "Heterozygous", "Jefferson" against
 * "Jackson" all sit under 0.8, while a reordering scores 1 and a single
 * misspelt word in a five-word phrase scores above 0.9. Err high — a false yes
 * strengthens a review interval the reader did not earn.
 */
export const SIMILARITY_THRESHOLD = 0.85;

/**
 * Below this many normalised characters the vector check is skipped.
 *
 * A four-letter word has two or three trigrams, so one shared trigram is a
 * large fraction of the whole and the cosine says nothing. Short answers are
 * exactly where `exact` and `fuzzy` already do the job.
 */
const MIN_SIMILARITY_LENGTH = 6;

/** Longest text the edit-distance table is built for. Past this, only `similar`. */
const MAX_FUZZY_LENGTH = 200;

const ARTICLE = /^(the|a|an) /;
const NEGATIONS = new Set(['not', 'no', 'never', 'none', 'neither', 'nor', 'without', 'nt']);

/**
 * The comparison form of a piece of text: accents, case, punctuation, spacing
 * and a leading article all removed. Two texts that normalise the same are
 * the same answer.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // "isn't" -> "isn t", so the negation guard sees the "t" it keys on as
    // its own token rather than glued to the verb.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(ARTICLE, '');
}

/** The first check that says yes, or null when none does. */
export function matchAnswerLocally(given: string, expected: string[]): LocalMatch | null {
  const candidates = expected.filter((candidate) => candidate.trim());
  if (!given.trim() || candidates.length === 0) return null;

  for (const against of candidates) {
    if (isExactMatch(given, against)) return { via: 'exact', against };
  }
  for (const against of candidates) {
    if (isFuzzyMatch(given, against)) return { via: 'fuzzy', against };
  }
  for (const against of candidates) {
    if (isSimilarMatch(given, against)) return { via: 'similar', against };
  }
  return null;
}

export function isExactMatch(given: string, expected: string): boolean {
  const a = normalizeForMatch(given);
  const b = normalizeForMatch(expected);
  return !!a && a === b;
}

/**
 * Whether the two texts are within a spelling slip of each other.
 *
 * Judged WORD BY WORD, not over the whole string. A budget over the whole
 * string lets two short words each change by one letter, which is exactly how
 * "north korea" becomes "south korea" and "east germany" becomes "west
 * germany" — two different answers two edits apart. Per word, each side has
 * to be the same words in the same order, and each word may carry one slip
 * (two, once it is long enough that two slips still leave it unmistakable).
 * A word of under five letters gets no slip at all: one edit turns "cat" into
 * "car".
 */
export function isFuzzyMatch(given: string, expected: string): boolean {
  const a = normalizeForMatch(given);
  const b = normalizeForMatch(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > MAX_FUZZY_LENGTH || b.length > MAX_FUZZY_LENGTH) return false;
  if (!guardsAgree(a, b)) return false;

  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  if (wordsA.length !== wordsB.length) return false;

  return wordsA.every((word, index) => {
    const other = wordsB[index];
    if (word === other) return true;
    const budget = editBudget(Math.max(word.length, other.length));
    if (budget === 0) return false;
    if (Math.abs(word.length - other.length) > budget) return false;
    return editDistance(word, other, budget) <= budget;
  });
}

/** Whether the two texts share enough subwords to be the same answer. */
export function isSimilarMatch(given: string, expected: string): boolean {
  const a = normalizeForMatch(given);
  const b = normalizeForMatch(expected);
  if (a.length < MIN_SIMILARITY_LENGTH || b.length < MIN_SIMILARITY_LENGTH) return false;
  if (a === b) return true;
  if (!guardsAgree(a, b)) return false;
  return similarity(a, b) >= SIMILARITY_THRESHOLD;
}

/** One slip per word once it is long enough to survive one; two for a long word. */
export function editBudget(length: number): number {
  if (length < 5) return 0;
  if (length < 14) return 1;
  return 2;
}

/**
 * Both guards, over normalised text: the numbers on each side must be the
 * same set, negation must be present on both or on neither, and neither side
 * may name one half of a contrasting pair that the other side names the
 * opposite half of.
 */
function guardsAgree(a: string, b: string): boolean {
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  return (
    sameSet(numbersIn(wordsA), numbersIn(wordsB)) &&
    isNegated(wordsA) === isNegated(wordsB) &&
    !contrast(wordsA, wordsB)
  );
}

/**
 * Digits, plus the number words that stand in for them. "World War Two" and
 * "World War One" are one letter apart and must not be one answer.
 */
function numbersIn(words: string[]): Set<string> {
  const found = new Set<string>();
  for (const word of words) {
    if (/^\p{N}+$/u.test(word)) found.add(word);
    const spelled = NUMBER_WORDS[word];
    if (spelled) found.add(spelled);
  }
  return found;
}

function isNegated(words: string[]): boolean {
  return words.some((word) => NEGATIONS.has(word));
}

/**
 * Whether the sides name different members of one contrast group — "north"
 * against "south", "left" against "right". These are the pairs that read as
 * spelling variants to a character-level comparison and are nothing of the
 * kind. Small and deliberately conservative: the cost of a missing group is
 * one answer going to the model that need not have, and the cost of a wrong
 * one is a right answer being sent there too. Neither is a wrong verdict.
 */
function contrast(wordsA: string[], wordsB: string[]): boolean {
  for (const word of wordsA) {
    const group = CONTRAST_GROUP.get(word);
    if (group === undefined) continue;
    for (const other of wordsB) {
      if (other !== word && CONTRAST_GROUP.get(other) === group) return true;
    }
  }
  return false;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7',
  eighth: '8', ninth: '9', tenth: '10',
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};

const CONTRAST_GROUPS: string[][] = [
  ['north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western'],
  ['left', 'right'],
  ['upper', 'lower'],
  ['inner', 'outer'],
  ['top', 'bottom'],
  ['front', 'back'],
  ['before', 'after'],
  ['above', 'below'],
  ['more', 'less', 'fewer'],
  ['most', 'least'],
  ['high', 'low', 'higher', 'lower', 'highest', 'lowest'],
  ['fast', 'slow'],
  ['hot', 'cold'],
  ['increase', 'decrease', 'increases', 'decreases', 'increasing', 'decreasing'],
  ['positive', 'negative'],
  ['male', 'female'],
  ['dominant', 'recessive'],
  ['homozygous', 'heterozygous'],
  ['prokaryotic', 'eukaryotic', 'prokaryote', 'eukaryote', 'prokaryotes', 'eukaryotes'],
  ['oxidation', 'reduction', 'oxidised', 'reduced', 'oxidized'],
  ['acid', 'base', 'acidic', 'basic', 'alkaline'],
  ['red', 'white'],
  ['black', 'white'],
  ['major', 'minor'],
  ['maximum', 'minimum'],
  ['strength', 'weakness', 'strengths', 'weaknesses'],
  ['union', 'confederacy', 'confederate'],
  ['allies', 'axis', 'allied'],
];

const CONTRAST_GROUP = new Map<string, number>();
CONTRAST_GROUPS.forEach((group, index) => {
  for (const word of group) CONTRAST_GROUP.set(word, index);
});

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and
 * a swap of two neighbouring characters, which is the most common typo of all
 * and would otherwise cost two.
 *
 * Stops early once every cell in a row is past `limit`, since the answer can
 * only grow from there and the caller only wants to know whether it is inside
 * the budget.
 */
export function editDistance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > limit) return rowMin;
    twoBack = previous;
    previous = current;
  }

  return previous[b.length];
}

/**
 * Cosine similarity between the subword vectors of two normalised texts.
 *
 * Each text becomes a sparse count of its whole words and of the character
 * trigrams inside each word, with the word padded so its start and end count
 * as features too ("cat" gives " ca", "cat", "at "). Whole words weigh more
 * than trigrams: the trigrams are there to forgive a misspelling, the words
 * are there to say the same things were named.
 */
export function similarity(a: string, b: string): number {
  const va = vectorize(a);
  const vb = vectorize(b);

  let dot = 0;
  for (const [feature, weight] of va) {
    const other = vb.get(feature);
    if (other) dot += weight * other;
  }
  const norm = Math.sqrt(magnitude(va) * magnitude(vb));
  return norm === 0 ? 0 : dot / norm;
}

const WORD_WEIGHT = 2;
const TRIGRAM_WEIGHT = 1;

function vectorize(text: string): Map<string, number> {
  const features = new Map<string, number>();
  const add = (feature: string, weight: number) => {
    features.set(feature, (features.get(feature) ?? 0) + weight);
  };

  for (const word of text.split(' ')) {
    if (!word) continue;
    add(`w:${word}`, WORD_WEIGHT);
    const padded = ` ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      add(`c:${padded.slice(index, index + 3)}`, TRIGRAM_WEIGHT);
    }
  }
  return features;
}

function magnitude(vector: Map<string, number>): number {
  let total = 0;
  for (const weight of vector.values()) total += weight * weight;
  return total;
}
