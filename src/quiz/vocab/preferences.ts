import { createStore } from '../../lib/createStore';
import { readJsonSync, writeJson } from '../../lib/kv';
import { hashString } from '../../lib/random';

/**
 * Where new words come from, and how many at a time.
 *
 * Modelled on `src/quiz/preferences.ts` rather than the envelope helpers: this
 * is a small settings object read whole, and a partial or stale stored value is
 * better repaired field by field than discarded.
 *
 * A theme is the reader's own description of the words they want, and it goes
 * into the suggestion prompt verbatim. That is deliberately the only steering
 * control: a "level" dial would be a second axis saying the same thing — "GRE
 * words" and "everyday words I misuse" are levels expressed as themes — and two
 * overlapping controls would pull against each other in one prompt.
 */

const PREFERENCES_KEY = 'quizbot.vocab.prefs.v1';

export type VocabTheme = {
  id: string;
  /** User-facing and user-editable. Sent to the model as written. */
  label: string;
  /**
   * `notes` also passes the topics already in the bank, so suggestions come
   * from the subjects the reader is actually studying.
   */
  kind: 'prompt' | 'notes';
  /** Seeded on first run. Editable, but not deletable. */
  builtin?: boolean;
  addedAt: number;
};

export type VocabPreferences = {
  themes: VocabTheme[];
  wordsPerBatch: number;
};

export const WORDS_PER_BATCH_CHOICES = [5, 10, 15, 20] as const;
const DEFAULT_WORDS_PER_BATCH = 10;
const MAX_THEME_CHARS = 120;
const MAX_THEMES = 12;

/**
 * Seeded once and thereafter re-added by id if missing, exactly as
 * `ensureBuiltinQuizzes` does. Built-ins are editable — someone who wants
 * "Uncommon but useful French words" should just change the label — but not
 * deletable, so there is always something to suggest from.
 */
const BUILTIN_THEMES: readonly Omit<VocabTheme, 'addedAt'>[] = [
  {
    id: 'useful',
    label: 'Uncommon but useful English words',
    kind: 'prompt',
    builtin: true,
  },
  {
    id: 'notes',
    label: "Terms from the subjects I'm studying",
    kind: 'notes',
    builtin: true,
  },
];

function isTheme(value: unknown): value is VocabTheme {
  if (!value || typeof value !== 'object') return false;
  const theme = value as Partial<VocabTheme>;
  return (
    typeof theme.id === 'string' &&
    theme.id.length > 0 &&
    typeof theme.label === 'string' &&
    theme.label.length > 0 &&
    (theme.kind === 'prompt' || theme.kind === 'notes')
  );
}

/** Tolerates a partial or stale stored value rather than discarding all of it. */
function loadSync(): VocabPreferences {
  const stored = readJsonSync<Partial<VocabPreferences>>(PREFERENCES_KEY);
  const themes = Array.isArray(stored?.themes) ? stored.themes.filter(isTheme) : [];
  const wordsPerBatch = WORDS_PER_BATCH_CHOICES.includes(
    stored?.wordsPerBatch as (typeof WORDS_PER_BATCH_CHOICES)[number],
  )
    ? (stored?.wordsPerBatch as number)
    : DEFAULT_WORDS_PER_BATCH;

  return { themes, wordsPerBatch };
}

export const vocabPreferencesStore = createStore<VocabPreferences>(loadSync());

function persist(next: VocabPreferences): void {
  vocabPreferencesStore.set(next);
  // Fire-and-forget: a failed preference write must not break the screen.
  void writeJson(PREFERENCES_KEY, next).catch(() => undefined);
}

/**
 * Idempotent seeding, called at module scope in the root layout beside
 * `ensureBuiltinQuizzes`. Synchronous, so the suggestion screen never renders
 * an empty theme list on first run.
 */
export function ensureBuiltinThemes(now = Date.now()): void {
  const current = vocabPreferencesStore.get();
  const missing = BUILTIN_THEMES.filter(
    (builtin) => !current.themes.some((theme) => theme.id === builtin.id),
  );
  if (missing.length === 0) return;

  persist({
    ...current,
    themes: [...current.themes, ...missing.map((theme) => ({ ...theme, addedAt: now }))],
  });
}

export function addTheme(label: string, now = Date.now()): VocabTheme | null {
  const trimmed = label.trim().slice(0, MAX_THEME_CHARS);
  if (!trimmed) return null;

  const current = vocabPreferencesStore.get();
  if (current.themes.length >= MAX_THEMES) return null;
  if (current.themes.some((theme) => theme.label.toLowerCase() === trimmed.toLowerCase())) {
    return null;
  }

  const theme: VocabTheme = {
    id: `theme-${hashString(`${trimmed}${now}`).toString(36)}`,
    label: trimmed,
    kind: 'prompt',
    addedAt: now,
  };
  persist({ ...current, themes: [...current.themes, theme] });
  return theme;
}

export function updateTheme(id: string, label: string): void {
  const trimmed = label.trim().slice(0, MAX_THEME_CHARS);
  if (!trimmed) return;

  const current = vocabPreferencesStore.get();
  persist({
    ...current,
    themes: current.themes.map((theme) => (theme.id === id ? { ...theme, label: trimmed } : theme)),
  });
}

/** Built-ins survive, the same way built-in quizzes do. */
export function removeTheme(id: string): void {
  const current = vocabPreferencesStore.get();
  const themes = current.themes.filter((theme) => theme.id !== id || theme.builtin);
  if (themes.length === current.themes.length) return;
  persist({ ...current, themes });
}

export function setWordsPerBatch(count: number): void {
  if (!WORDS_PER_BATCH_CHOICES.includes(count as (typeof WORDS_PER_BATCH_CHOICES)[number])) return;
  persist({ ...vocabPreferencesStore.get(), wordsPerBatch: count });
}

export function getVocabPreferences(): VocabPreferences {
  return vocabPreferencesStore.get();
}

export function getThemeById(id: string): VocabTheme | undefined {
  return vocabPreferencesStore.get().themes.find((theme) => theme.id === id);
}

export function useVocabThemes(): VocabTheme[] {
  return vocabPreferencesStore.useSelector((state) => state.themes);
}

export function useWordsPerBatch(): number {
  return vocabPreferencesStore.useSelector((state) => state.wordsPerBatch);
}
