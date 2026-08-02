import { formatTopic, normalizeTopic, normalizeTopics, topicVocabulary } from './topics';

describe('normalizeTopic', () => {
  it('slugifies to lowercase kebab', () => {
    expect(normalizeTopic('React Hooks')).toBe('react-hooks');
    expect(normalizeTopic('  Spaced   Repetition  ')).toBe('spaced-repetition');
    expect(normalizeTopic('OAuth2.0')).toBe('oauth2-0');
  });

  /** The whole point: these three must collapse to one topic. */
  it('collapses casing and punctuation variants', () => {
    const variants = ['React Hooks', 'react hooks', 'react-hooks', 'React_Hooks!'];
    const normalized = new Set(variants.map(normalizeTopic));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe('react-hooks');
  });

  it('folds accents so synonyms do not split', () => {
    expect(normalizeTopic('café')).toBe(normalizeTopic('cafe'));
  });

  it('rejects empties, punctuation-only, and stopwords', () => {
    expect(normalizeTopic('')).toBeNull();
    expect(normalizeTopic('   ')).toBeNull();
    expect(normalizeTopic('!!!')).toBeNull();
    expect(normalizeTopic('the')).toBeNull();
    expect(normalizeTopic('Misc')).toBeNull();
    expect(normalizeTopic('chapter')).toBeNull();
    expect(normalizeTopic('Untitled')).toBeNull();
  });

  it('truncates a long topic at a word boundary, not mid-word', () => {
    // A hard slice produced "podcast-netherlands-the-revolt-t", which is what a
    // mangled topic looks like everywhere it's displayed.
    const topic = normalizeTopic('Podcast Netherlands The Revolt That Made The Modern World');
    expect(topic).toBe('podcast-netherlands-the-revolt');
    expect(topic?.endsWith('-')).toBe(false);
  });

  it('truncates without leaving a trailing hyphen', () => {
    const result = normalizeTopic('a'.repeat(40));
    expect(result).toHaveLength(32);
    expect(result?.endsWith('-')).toBe(false);

    const wordy = normalizeTopic(`${'x'.repeat(30)} something`);
    expect(wordy?.endsWith('-')).toBe(false);
  });
});

describe('normalizeTopics', () => {
  it('dedupes after normalization', () => {
    expect(normalizeTopics(['React Hooks', 'react-hooks', 'REACT HOOKS'])).toEqual(['react-hooks']);
  });

  it('drops unusable entries but keeps the rest', () => {
    expect(normalizeTopics(['the', 'Authentication', '', 'Tokens'])).toEqual([
      'authentication',
      'tokens',
    ]);
  });

  it('caps at three, preserving relevance order', () => {
    expect(normalizeTopics(['One', 'Two', 'Three', 'Four', 'Five'])).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('returns an empty array rather than a bogus entry', () => {
    expect(normalizeTopics([])).toEqual([]);
    expect(normalizeTopics(['the', 'a', '!!!'])).toEqual([]);
  });
});

describe('formatTopic', () => {
  it('renders a slug for display', () => {
    expect(formatTopic('react-hooks')).toBe('React Hooks');
    expect(formatTopic('oauth')).toBe('Oauth');
    expect(formatTopic('')).toBe('');
  });
});

describe('topicVocabulary', () => {
  const bank = [
    { topics: ['auth', 'tokens'] },
    { topics: ['auth'] },
    { topics: ['auth', 'react-hooks'] },
    { topics: ['tokens'] },
    { topics: [] },
  ];

  it('counts occurrences across the bank', () => {
    expect(topicVocabulary(bank)).toEqual([
      { topic: 'auth', count: 3 },
      { topic: 'tokens', count: 2 },
      { topic: 'react-hooks', count: 1 },
    ]);
  });

  it('breaks count ties alphabetically so ordering is stable', () => {
    const result = topicVocabulary([{ topics: ['zebra'] }, { topics: ['alpha'] }]);
    expect(result.map((entry) => entry.topic)).toEqual(['alpha', 'zebra']);
  });

  it('handles an empty bank', () => {
    expect(topicVocabulary([])).toEqual([]);
  });
});
