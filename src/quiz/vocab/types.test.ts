import { normalizeTopic } from '../topics';
import {
  isValidVocabWord,
  slugFromPath,
  validateWord,
  vocabPath,
  vocabSlug,
  VOCAB_SOURCE_ID,
} from './types';

describe('vocabSlug', () => {
  it('treats a word as the same word whatever the casing', () => {
    expect(vocabSlug('Laconic')).toBe('laconic');
    expect(vocabSlug('  LACONIC  ')).toBe('laconic');
  });

  it('strips accents, so "naïve" and "naive" are not two separate words', () => {
    expect(vocabSlug('naïve')).toBe(vocabSlug('naive'));
  });

  it('keeps a phrase as one entry rather than splitting it', () => {
    expect(vocabSlug('esprit de corps')).toBe('esprit-de-corps');
  });

  it('drops punctuation people type without thinking', () => {
    expect(vocabSlug('"laconic,"')).toBe('laconic');
  });

  /*
    The reason this module has its own normalizer instead of reusing
    `normalizeTopic`. That one drops stopwords to keep the topic vocabulary
    coherent, which would refuse a perfectly reasonable word to learn — and
    would orphan an already-saved one the day a stopword is added.
  */
  it('keeps a word the topic normalizer would throw away as a stopword', () => {
    expect(normalizeTopic('part')).toBeNull();
    expect(vocabSlug('part')).toBe('part');
  });
});

describe('vocabPath / slugFromPath', () => {
  it('round-trips a slug through the synthetic note path', () => {
    expect(slugFromPath(vocabPath('laconic'))).toBe('laconic');
  });

  it('reports nothing for a real note, so note questions are never mistaken for words', () => {
    expect(slugFromPath('notes/Thinking Fast and Slow 4.md')).toBeUndefined();
    expect(slugFromPath(undefined)).toBeUndefined();
  });
});

describe('validateWord', () => {
  it('accepts a plain word and reports both forms', () => {
    expect(validateWord('  Laconic ')).toEqual({ ok: true, word: 'Laconic', slug: 'laconic' });
  });

  it('accepts a short phrase, because "ad hoc" is a thing people want to learn', () => {
    expect(validateWord('ad hoc')).toMatchObject({ ok: true, slug: 'ad-hoc' });
    expect(validateWord('esprit de corps')).toMatchObject({ ok: true, slug: 'esprit-de-corps' });
  });

  it('collapses runs of whitespace rather than rejecting them', () => {
    expect(validateWord('beg   the  question')).toMatchObject({
      ok: true,
      word: 'beg the question',
    });
  });

  it('refuses a whole sentence', () => {
    expect(validateWord('what is the meaning of this word please')).toMatchObject({ ok: false });
  });

  it('refuses an entry with no letters in it', () => {
    expect(validateWord('123')).toMatchObject({ ok: false });
    expect(validateWord('!!!')).toMatchObject({ ok: false });
  });

  it('refuses an empty field', () => {
    expect(validateWord('   ')).toMatchObject({ ok: false });
  });
});

describe('isValidVocabWord', () => {
  const valid = { slug: 'laconic', word: 'laconic', addedAt: 1, addedBy: 'user' };

  it('accepts a minimal row', () => {
    expect(isValidVocabWord(valid)).toBe(true);
  });

  it('drops a row with no slug, so one bad entry cannot key the whole record', () => {
    expect(isValidVocabWord({ ...valid, slug: '' })).toBe(false);
  });

  it('drops a row whose origin it does not recognise', () => {
    expect(isValidVocabWord({ ...valid, addedBy: 'somewhere-else' })).toBe(false);
  });
});

it('reserves a source id that a real source could never collide with', () => {
  // Real ids are namespaced `github-repo:${repoId}` — see sources/types.ts.
  expect(VOCAB_SOURCE_ID).not.toContain(':');
});
