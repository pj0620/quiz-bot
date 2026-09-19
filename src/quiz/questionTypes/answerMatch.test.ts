import {
  SIMILARITY_THRESHOLD,
  editBudget,
  editDistance,
  isExactMatch,
  isFuzzyMatch,
  isSimilarMatch,
  matchAnswerLocally,
  normalizeForMatch,
  similarity,
} from './answerMatch';

describe('normalizeForMatch', () => {
  it('ignores case, punctuation, accents and spacing', () => {
    expect(normalizeForMatch('  Bull!  ')).toBe('bull');
    expect(normalizeForMatch('Café')).toBe('cafe');
    expect(normalizeForMatch('fast,   automatic  system.')).toBe('fast automatic system');
  });

  it('drops a leading article and nothing else', () => {
    expect(normalizeForMatch('The Bull')).toBe('bull');
    expect(normalizeForMatch('an apple')).toBe('apple');
    // Only at the start: "of the" is part of the answer.
    expect(normalizeForMatch('Battle of the Bulge')).toBe('battle of the bulge');
  });

  it('splits a contraction so its negation is visible', () => {
    expect(normalizeForMatch("isn't")).toBe('isn t');
  });
});

describe('isExactMatch', () => {
  it('is the same answer once normalised', () => {
    expect(isExactMatch('bull', 'Bull')).toBe(true);
    expect(isExactMatch('the Bull', 'bull')).toBe(true);
    expect(isExactMatch('System 1, the fast automatic system', 'system 1 the fast automatic system')).toBe(true);
  });

  it('never matches empty text', () => {
    expect(isExactMatch('', '')).toBe(false);
    expect(isExactMatch('  ', 'bull')).toBe(false);
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('counts a swap of neighbouring letters as one edit', () => {
    // The most common typo of all; plain Levenshtein charges two for it.
    expect(editDistance('recieve', 'receive')).toBe(1);
  });

  it('reports "over the limit" without finishing the table', () => {
    expect(editDistance('completely', 'different', 2)).toBeGreaterThan(2);
  });
});

describe('editBudget', () => {
  it('allows no slip in a short word, one in a normal one, two in a long one', () => {
    expect(editBudget(3)).toBe(0);
    expect(editBudget(4)).toBe(0);
    expect(editBudget(5)).toBe(1);
    expect(editBudget(13)).toBe(1);
    expect(editBudget(14)).toBe(2);
  });
});

describe('isFuzzyMatch', () => {
  it('forgives a spelling slip', () => {
    expect(isFuzzyMatch('Kentuky', 'Kentucky')).toBe(true);
    expect(isFuzzyMatch('photosynthesys', 'photosynthesis')).toBe(true);
    expect(isFuzzyMatch('Gettysburg adress', 'Gettysburg Address')).toBe(true);
    expect(isFuzzyMatch('emancipation proclamtion', 'the Emancipation Proclamation')).toBe(true);
    expect(isFuzzyMatch('bulls', 'bull')).toBe(true);
  });

  it('forgives one slip in each of several words', () => {
    expect(isFuzzyMatch('kentucky to avoid pressuring it toward the south', 'Kentucky, to avoid pressuring it towards the south.')).toBe(true);
  });

  it('gives a short word no slip at all', () => {
    // One edit turns "cat" into "car": too little text to forgive anything.
    expect(isFuzzyMatch('bul', 'bull')).toBe(false);
    expect(isFuzzyMatch('ran', 'run')).toBe(false);
  });

  it('judges word by word, so two short words cannot each drift', () => {
    expect(isFuzzyMatch('north korea', 'south korea')).toBe(false);
    expect(isFuzzyMatch('east germany', 'west germany')).toBe(false);
  });

  it('refuses a different word that is two edits away', () => {
    expect(isFuzzyMatch('hypothalamus', 'hypothalamic')).toBe(false);
    expect(isFuzzyMatch('sodium chloride', 'sodium chlorate')).toBe(false);
    expect(isFuzzyMatch('adenosine triphosphate', 'adenosine diphosphate')).toBe(false);
    expect(isFuzzyMatch('mitosis', 'meiosis')).toBe(false);
  });

  it('needs the same number of words', () => {
    expect(isFuzzyMatch('Gettysburg', 'Gettysburg Address')).toBe(false);
  });
});

describe('isSimilarMatch', () => {
  it('forgives reordered words', () => {
    expect(isSimilarMatch('automatic fast system', 'fast automatic system')).toBe(true);
    expect(isSimilarMatch('lincoln abraham', 'Abraham Lincoln')).toBe(true);
  });

  it('is skipped for very short text, where trigrams say nothing', () => {
    expect(isSimilarMatch('bull', 'bulls')).toBe(false);
  });

  it('does not confuse near misses for the same answer', () => {
    const misses: [string, string][] = [
      ['Economic Strength', 'Economic Weakness'],
      ['homozygous', 'heterozygous'],
      ['Jefferson', 'Jackson'],
      ['Franklin Roosevelt', 'Theodore Roosevelt'],
      ['declaration of independence', 'declaration of the rights of man'],
      ['ionic bond', 'covalent bond'],
      ['cerebellum', 'cerebrum'],
      ['glucose', 'glucagon'],
      ['Gettysburg', 'Gettysburg Address'],
    ];
    for (const [given, expected] of misses) {
      expect(isSimilarMatch(given, expected)).toBe(false);
      // Not just guarded away: the score itself is under the line.
      expect(similarity(normalizeForMatch(given), normalizeForMatch(expected))).toBeLessThan(SIMILARITY_THRESHOLD);
    }
  });
});

describe('guards', () => {
  it('refuse when the numbers differ, however alike the text', () => {
    expect(matchAnswerLocally('System 2', ['System 1'])).toBeNull();
    expect(matchAnswerLocally('treaty of paris 1763', ['treaty of paris 1783'])).toBeNull();
    expect(matchAnswerLocally('Sytem 1', ['System 1'])?.via).toBe('fuzzy');
  });

  it('read number words and roman numerals as numbers', () => {
    expect(matchAnswerLocally('World War Two', ['World War One'])).toBeNull();
    expect(matchAnswerLocally('second battle of bull run', ['first battle of bull run'])).toBeNull();
    expect(matchAnswerLocally('Henry VII', ['Henry VIII'])).toBeNull();
  });

  it('refuse when only one side is negated', () => {
    expect(matchAnswerLocally('not a bull', ['a bull'])).toBeNull();
    expect(matchAnswerLocally("isn't a bull", ['a bull'])).toBeNull();
    expect(matchAnswerLocally('never a bull', ['a bull'])).toBeNull();
  });

  it('refuse the opposite half of a contrasting pair', () => {
    expect(matchAnswerLocally('left ventricle', ['right ventricle'])).toBeNull();
    expect(matchAnswerLocally('southern hemisphere', ['northern hemisphere'])).toBeNull();
    expect(matchAnswerLocally('upper house', ['lower house'])).toBeNull();
    expect(matchAnswerLocally('slow thinking', ['fast thinking'])).toBeNull();
    expect(matchAnswerLocally('white blood cells', ['red blood cells'])).toBeNull();
    expect(matchAnswerLocally('recessive allele', ['dominant allele'])).toBeNull();
  });

  it('do not refuse the same half on both sides', () => {
    expect(matchAnswerLocally('the north', ['North'])?.via).toBe('exact');
    expect(matchAnswerLocally('left ventricel', ['left ventricle'])?.via).toBe('fuzzy');
  });
});

describe('matchAnswerLocally', () => {
  it('reports the cheapest check that said yes and what it matched', () => {
    expect(matchAnswerLocally('bull', ['Bull'])).toEqual({ via: 'exact', against: 'Bull' });
    expect(matchAnswerLocally('Kentuky', ['Kentucky'])).toEqual({ via: 'fuzzy', against: 'Kentucky' });
    expect(matchAnswerLocally('automatic fast system', ['fast automatic system'])).toEqual({
      via: 'similar',
      against: 'fast automatic system',
    });
  });

  it('tries every candidate before moving to a looser check', () => {
    // An exact hit on the second candidate beats a fuzzy hit on the first.
    expect(matchAnswerLocally('S1', ['S2', 's1'])).toEqual({ via: 'exact', against: 's1' });
  });

  it('is null for a paraphrase, a synonym, or a wrong answer alike', () => {
    // These are the model's job (or the reader's) — never a local "incorrect".
    expect(matchAnswerLocally('Soviet Union', ['USSR'])).toBeNull();
    expect(matchAnswerLocally('System 1', ['System 1, the fast automatic system.'])).toBeNull();
    expect(matchAnswerLocally('Ohio', ['Kentucky'])).toBeNull();
  });

  it('is null for empty input on either side', () => {
    expect(matchAnswerLocally('', ['bull'])).toBeNull();
    expect(matchAnswerLocally('bull', [])).toBeNull();
    expect(matchAnswerLocally('bull', ['', '  '])).toBeNull();
  });
});
