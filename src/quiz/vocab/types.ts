import type { Question } from '../types';

/**
 * Vocabulary: questions about a single WORD rather than about a note.
 *
 * This is the app's first material with no file behind it, and the whole design
 * turns on one decision — a vocab question is an ORDINARY `Question` carrying a
 * reserved `sourceId`, not a new shape.
 *
 * `sourceId` is required on every question, so a value has to be chosen either
 * way; adding a second `origin` discriminator alongside it would leave
 * `sourceId` still needing one and give the codebase two ways to ask the same
 * question. Real source ids are namespaced (`github-repo:42`), so a bare
 * `vocab` cannot collide with one, and `sourceId: 'sample'` in Settings already
 * set the precedent for a synthetic value.
 *
 * What that buys, for free:
 *
 *  - Deterministic ids. `parseQuestions` hashes sourceId + path + format +
 *    prompt, so `vocab/laconic` namespaces a word's questions and re-running a
 *    word dedupes in `addQuestions` exactly as re-reading a note does.
 *  - The SRS, the player, the bank browser and the quiz rules all work
 *    untouched, because there is nothing new for them to understand.
 */

export const VOCAB_SOURCE_ID = 'vocab';

/**
 * The topic every vocab question carries.
 *
 * Fixed, never model-chosen, for the reason `generation/noteTopics.ts` spells
 * out: a model asked to pick topics drifts between synonyms and re-fragments
 * the vocabulary within a few runs. Being a constant is also what makes a
 * "Vocabulary" quiz buildable through the existing topic picker with no new
 * quiz machinery at all.
 */
export const VOCAB_TOPIC = 'vocabulary';

/** Long enough for "esprit de corps", short enough to keep out pasted prose. */
export const MAX_WORD_CHARS = 60;

/** Beyond this it is a sentence, not a thing to learn. */
const MAX_WORD_TOKENS = 4;

/**
 * A word in the ledger.
 *
 * Deliberately carries NO question count. The bank is the only authority on how
 * many questions a word has, and a stored copy goes stale the moment one is
 * deleted from the edit screen — or wholesale when the bank is cleared, leaving
 * every row claiming questions that no longer exist. Derived at render time
 * instead, which also means clearing the bank needs no vocab bookkeeping: the
 * counts fall to zero on their own and the "write questions" offer comes back.
 */
export type VocabWord = {
  /** Identity. Lowercase, accent-stripped, spaces hyphenated. */
  slug: string;
  /** The display form, as the user typed it or the model returned it. */
  word: string;
  definition?: string;
  partOfSpeech?: string;
  /** The suggestion theme this came from. Display only — never a topic. */
  theme?: string;
  addedAt: number;
  addedBy: 'user' | 'ai';
  /** Absent until a run has succeeded for this word. */
  lastGeneratedAt?: number;
  /** Set when the last attempt failed, so the word can be retried knowingly. */
  lastError?: string;
};

/**
 * "Beg the Question!" -> "beg-the-question".
 *
 * Deliberately NOT `normalizeTopic`, despite the near-identical shape. That one
 * drops stopwords and truncates at 32 characters to keep the TOPIC vocabulary
 * coherent — rules that exist for a different purpose and may change for it.
 * Coupling word identity to them means a future stopword addition silently
 * orphans someone's saved word: "part" and "misc" are perfectly good things to
 * want to learn.
 */
export function vocabSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Accents to ASCII, so "naïve" and "naive" are one word rather than two.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The synthetic note path a word's question ids are hashed from. */
export function vocabPath(slug: string): string {
  return `vocab/${slug}`;
}

/** The word a vocab question belongs to, or undefined for anything else. */
export function slugFromPath(path: string | undefined): string | undefined {
  if (!path?.startsWith('vocab/')) return undefined;
  const slug = path.slice('vocab/'.length);
  return slug || undefined;
}

export function isVocabQuestion(question: Question): boolean {
  return question.sourceId === VOCAB_SOURCE_ID;
}

export type WordValidation =
  | { ok: true; word: string; slug: string }
  | { ok: false; reason: string };

/**
 * The entire input-validation surface for a typed word.
 *
 * Multi-word entries are allowed on purpose. "ad hoc", "esprit de corps" and
 * "beg the question" are exactly what someone means by a word they want to
 * learn, the model handles them identically, and refusing them is a far more
 * annoying failure than accepting a phrase one token too long would be.
 */
export function validateWord(raw: string): WordValidation {
  const word = raw.trim().replace(/\s+/g, ' ');

  if (!word) return { ok: false, reason: 'Type a word first.' };
  if (word.length > MAX_WORD_CHARS) {
    return { ok: false, reason: `Keep it under ${MAX_WORD_CHARS} characters.` };
  }
  if (word.split(' ').length > MAX_WORD_TOKENS) {
    return { ok: false, reason: 'That looks like a sentence — add one word or a short phrase.' };
  }

  const slug = vocabSlug(word);
  if (!slug || !/[a-z]/.test(slug)) {
    return { ok: false, reason: "That doesn't look like a word." };
  }

  return { ok: true, word, slug };
}

export function isValidVocabWord(value: unknown): value is VocabWord {
  if (!value || typeof value !== 'object') return false;
  const word = value as Partial<VocabWord>;
  return (
    typeof word.slug === 'string' &&
    word.slug.length > 0 &&
    typeof word.word === 'string' &&
    word.word.length > 0 &&
    typeof word.addedAt === 'number' &&
    (word.addedBy === 'user' || word.addedBy === 'ai')
  );
}
