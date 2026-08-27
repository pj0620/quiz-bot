import { createStore } from '../../lib/createStore';
import { deleteQuestion, getQuestions } from '../store';
import { loadVocabSync, MAX_VOCAB_WORDS, vocabSaver } from './storage';
import { isVocabQuestion, slugFromPath, vocabSlug, type VocabWord } from './types';

/**
 * The word ledger.
 *
 * Follows the convention in `src/quiz/store.ts`: module-level creation with
 * synchronous hydration, a private fire-and-forget persist, exported free
 * functions as the only mutation API, and non-hook getters for imperative
 * callers.
 *
 * Kept SEPARATE from the question bank rather than derived from it, and the
 * first three reasons are each on their own decisive:
 *
 *  - A word whose generation failed has no questions, so it would not exist —
 *    leaving nowhere to record why, and no way to retry it.
 *  - `capBank` evicts unseen questions at 5,000; the word would go with them.
 *  - `clearQuestionBank()` would wipe the curated list. That is the mirror of
 *    the coverage mistake documented in `store.ts:192-195`: there, keeping a
 *    ledger blocked regeneration; here, keeping it is what ENABLES it.
 *
 * And three more: the "don't suggest these again" list has to outlive all of
 * the above, a definition has no home on a question, and a browsable word list
 * is the feature — a groupBy over five thousand questions is an implementation
 * of it, not a design for it.
 */

type VocabState = { words: Record<string, VocabWord> };

export const vocabStore = createStore<VocabState>({ words: loadVocabSync() });

function persist(words: Record<string, VocabWord>): void {
  vocabSaver.schedule(words);
}

export type NewVocabWord = {
  word: string;
  definition?: string;
  partOfSpeech?: string;
  theme?: string;
  addedBy: 'user' | 'ai';
};

/**
 * Adds a word, or reports that it is already there.
 *
 * Existing rows win, like `addQuestions`: the stored row may carry a definition
 * and a generation history that a bare re-add would flatten.
 */
export function addWord(input: NewVocabWord, now = Date.now()): { slug: string; added: boolean } {
  const slug = vocabSlug(input.word);
  const state = vocabStore.get();

  if (state.words[slug]) return { slug, added: false };
  if (Object.keys(state.words).length >= MAX_VOCAB_WORDS) return { slug, added: false };

  // Spread conditionally throughout: under `exactOptionalPropertyTypes`, writing
  // `definition: undefined` is not the same as omitting the key.
  const word: VocabWord = {
    slug,
    word: input.word,
    ...(input.definition ? { definition: input.definition } : {}),
    ...(input.partOfSpeech ? { partOfSpeech: input.partOfSpeech } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
    addedAt: now,
    addedBy: input.addedBy,
  };

  const words = { ...state.words, [slug]: word };
  vocabStore.set({ words });
  persist(words);
  return { slug, added: true };
}

/** Adds several, reporting which were already present so the UI can say so. */
export function addWords(
  entries: readonly NewVocabWord[],
  now = Date.now(),
): { added: string[]; duplicates: string[] } {
  const added: string[] = [];
  const duplicates: string[] = [];
  for (const entry of entries) {
    const result = addWord(entry, now);
    (result.added ? added : duplicates).push(result.slug);
  }
  return { added, duplicates };
}

function patch(slug: string, change: (word: VocabWord) => VocabWord): void {
  const state = vocabStore.get();
  const existing = state.words[slug];
  if (!existing) return;
  const words = { ...state.words, [slug]: change(existing) };
  vocabStore.set({ words });
  persist(words);
}

/**
 * Stores the meaning the model actually wrote the questions against.
 *
 * Worth keeping even though the questions carry it too: it is what the word
 * list shows, and it survives the questions being deleted.
 */
export function updateWordSense(
  slug: string,
  sense: { definition?: string; partOfSpeech?: string },
): void {
  patch(slug, (word) => ({
    ...word,
    ...(sense.definition ? { definition: sense.definition } : {}),
    ...(sense.partOfSpeech ? { partOfSpeech: sense.partOfSpeech } : {}),
  }));
}

/** A successful run. Clears any recorded failure — it is no longer true. */
export function recordGenerated(slug: string, now = Date.now()): void {
  patch(slug, (word) => {
    const { lastError: _lastError, ...rest } = word;
    return { ...rest, lastGeneratedAt: now };
  });
}

export function recordFailure(slug: string, message: string): void {
  patch(slug, (word) => ({ ...word, lastError: message }));
}

/**
 * Removes a word AND its questions.
 *
 * Goes through `deleteQuestion` per id rather than filtering the bank, for a
 * reason that is invisible until it bites: ids are deterministic, so a review
 * state left behind would be re-adopted if the same word were ever added again
 * — handing the user a brand new question already carrying a stranger's
 * schedule. `deleteQuestion` clears the review state and any unsettled session
 * item alongside the question itself.
 */
export function removeWord(slug: string): { removedQuestions: number } {
  const state = vocabStore.get();
  if (!state.words[slug]) return { removedQuestions: 0 };

  const { [slug]: _removed, ...words } = state.words;
  vocabStore.set({ words });
  persist(words);

  let removedQuestions = 0;
  for (const question of questionsForWord(slug)) {
    if (deleteQuestion(question.id)) removedQuestions += 1;
  }
  return { removedQuestions };
}

export function getVocabWords(): Record<string, VocabWord> {
  return vocabStore.get().words;
}

export function getVocabWord(slug: string): VocabWord | undefined {
  return vocabStore.get().words[slug];
}

/** Most recently added first — the order the list screen shows. */
export function listVocabWords(): VocabWord[] {
  return Object.values(vocabStore.get().words).sort((a, b) => b.addedAt - a.addedAt);
}

/** The bank is the authority on this, which is why no count is stored. */
export function questionsForWord(slug: string) {
  return getQuestions().filter(
    (question) => isVocabQuestion(question) && slugFromPath(question.provenance.path) === slug,
  );
}
