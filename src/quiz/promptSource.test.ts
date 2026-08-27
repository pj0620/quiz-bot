import {
  FALLBACK_PROMPT_TOPIC,
  MAX_PROMPT_CHARS,
  promptPath,
  promptSlug,
  promptTopics,
  validatePrompt,
} from './promptSource';

describe('promptSlug', () => {
  it('lowercases, hyphenates and strips accents', () => {
    expect(promptSlug('History of the Whig Party!')).toBe('history-of-the-whig-party');
    expect(promptSlug('Café society')).toBe('cafe-society');
  });

  it('collapses runs of punctuation and trims edges', () => {
    expect(promptSlug('  -- how vaccines work?? ')).toBe('how-vaccines-work');
  });
});

describe('promptPath', () => {
  it('namespaces under prompt/', () => {
    expect(promptPath('whig-party')).toBe('prompt/whig-party');
  });
});

describe('promptTopics', () => {
  it('derives one topic from the prompt, trimmed at a word boundary', () => {
    expect(promptTopics('History of the Whig party')).toEqual(['history-of-the-whig-party']);
    // Longer than the 32-char topic cap — cut at a hyphen, not mid-word.
    const [topic] = promptTopics('The revolt that made the modern world happen');
    expect(topic.length).toBeLessThanOrEqual(32);
    expect(topic.endsWith('-')).toBe(false);
  });

  it('falls back to a fixed bucket when nothing usable survives', () => {
    // "notes" alone is a stopword, so the whole prompt normalizes to nothing.
    expect(promptTopics('notes')).toEqual([FALLBACK_PROMPT_TOPIC]);
  });
});

describe('validatePrompt', () => {
  it('accepts a normal subject and collapses inner whitespace', () => {
    const result = validatePrompt('  History of   the Whig party ');
    expect(result).toEqual({
      ok: true,
      prompt: 'History of the Whig party',
      slug: 'history-of-the-whig-party',
    });
  });

  it('rejects empty and near-empty input', () => {
    expect(validatePrompt('').ok).toBe(false);
    expect(validatePrompt('  ').ok).toBe(false);
    expect(validatePrompt('ab').ok).toBe(false);
  });

  it('rejects pasted essays', () => {
    expect(validatePrompt('x'.repeat(MAX_PROMPT_CHARS + 1)).ok).toBe(false);
  });

  it('rejects input with nothing sluggable in it', () => {
    expect(validatePrompt('???!!!').ok).toBe(false);
  });
});
