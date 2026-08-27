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
  addTheme,
  ensureBuiltinThemes,
  getVocabPreferences,
  removeTheme,
  setWordsPerBatch,
  updateTheme,
  vocabPreferencesStore,
  WORDS_PER_BATCH_CHOICES,
} from './preferences';

const NOW = 1_760_000_000_000;

beforeEach(() => {
  vocabPreferencesStore.set({ themes: [], wordsPerBatch: 10 });
});

describe('ensureBuiltinThemes', () => {
  it('seeds something to suggest from on first run', () => {
    ensureBuiltinThemes(NOW);
    expect(getVocabPreferences().themes.length).toBeGreaterThan(0);
  });

  it('offers a theme that draws on what the reader is already studying', () => {
    ensureBuiltinThemes(NOW);
    expect(getVocabPreferences().themes.some((theme) => theme.kind === 'notes')).toBe(true);
  });

  it('runs twice without duplicating anything, since it runs on every launch', () => {
    ensureBuiltinThemes(NOW);
    const count = getVocabPreferences().themes.length;
    ensureBuiltinThemes(NOW);
    expect(getVocabPreferences().themes).toHaveLength(count);
  });

  it('does not undo an edit to a built-in label', () => {
    ensureBuiltinThemes(NOW);
    const [first] = getVocabPreferences().themes;
    updateTheme(first.id, 'Uncommon but useful French words');

    ensureBuiltinThemes(NOW);
    expect(getVocabPreferences().themes[0].label).toBe('Uncommon but useful French words');
  });

  it('puts back a built-in that has somehow gone missing', () => {
    ensureBuiltinThemes(NOW);
    vocabPreferencesStore.set({ ...getVocabPreferences(), themes: [] });

    ensureBuiltinThemes(NOW);
    expect(getVocabPreferences().themes.length).toBeGreaterThan(0);
  });
});

describe('themes', () => {
  it('adds one the reader wrote', () => {
    expect(addTheme('Legal Latin', NOW)).toMatchObject({ label: 'Legal Latin', kind: 'prompt' });
    expect(getVocabPreferences().themes).toHaveLength(1);
  });

  it('refuses a blank one rather than storing an unnameable chip', () => {
    expect(addTheme('   ', NOW)).toBeNull();
    expect(getVocabPreferences().themes).toHaveLength(0);
  });

  it('refuses one that is already there, whatever the casing', () => {
    addTheme('Legal Latin', NOW);
    expect(addTheme('legal latin', NOW)).toBeNull();
    expect(getVocabPreferences().themes).toHaveLength(1);
  });

  it('removes one the reader added', () => {
    const theme = addTheme('Legal Latin', NOW);
    removeTheme(theme!.id);
    expect(getVocabPreferences().themes).toHaveLength(0);
  });

  /*
    The same rule built-in quizzes follow: editable, because someone may want
    different words, but not deletable — an empty theme list would leave the
    suggestion screen with nothing to offer and no way back.
  */
  it('keeps a built-in when asked to delete it', () => {
    ensureBuiltinThemes(NOW);
    const [builtin] = getVocabPreferences().themes;
    removeTheme(builtin.id);
    expect(getVocabPreferences().themes.some((theme) => theme.id === builtin.id)).toBe(true);
  });
});

describe('wordsPerBatch', () => {
  it('takes one of the offered sizes', () => {
    setWordsPerBatch(20);
    expect(getVocabPreferences().wordsPerBatch).toBe(20);
  });

  it('ignores a size that is not on offer, rather than storing a number nothing shows', () => {
    setWordsPerBatch(9999);
    expect(WORDS_PER_BATCH_CHOICES).toContain(getVocabPreferences().wordsPerBatch);
  });
});
