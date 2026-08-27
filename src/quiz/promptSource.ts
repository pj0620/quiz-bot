import type { Question } from './types';
import { normalizeTopics } from './topics';

/**
 * Prompt-generated questions: material the reader ASKED FOR by describing it,
 * rather than material read out of a note.
 *
 * The design copies vocabulary wholesale (see `src/quiz/vocab/types.ts`): a
 * prompt question is an ORDINARY `Question` carrying a reserved `sourceId`,
 * not a new shape. That one decision is what lets the SRS, the player, the
 * bank browser and quiz rules all handle these with no new machinery.
 *
 * Real source ids are namespaced (`github-repo:42`), so a bare `prompt` cannot
 * collide with one — the same argument that justified `vocab` and `sample`.
 */

export const PROMPT_SOURCE_ID = 'prompt';

/** Everything a prompt run needs to remember about what was asked. */
export const MAX_PROMPT_CHARS = 200;

/**
 * "History of the Whig Party!" -> "history-of-the-whig-party".
 *
 * Deliberately NOT `normalizeTopic`: that one drops stopwords and truncates at
 * 32 characters to keep the topic vocabulary coherent — rules that serve a
 * different job and may change for it. This slug is IDENTITY: it namespaces a
 * prompt's question ids, so re-running the same prompt dedupes in
 * `addQuestions` exactly as re-reading an unchanged note does.
 */
export function promptSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Accents to ASCII, so "Café society" re-run as "Cafe society" dedupes.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The synthetic note path a prompt's question ids are hashed from. */
export function promptPath(slug: string): string {
  return `prompt/${slug}`;
}

export function isPromptQuestion(question: Question): boolean {
  return question.sourceId === PROMPT_SOURCE_ID;
}

/**
 * The topic when the prompt itself normalizes to nothing — a prompt of pure
 * stopwords like "the things". Rare, but a question with no topic at all
 * disappears from the topic chips and from topic quizzes, which is a worse
 * outcome than a generic bucket.
 */
export const FALLBACK_PROMPT_TOPIC = 'asked-for';

/**
 * The topics a prompt's questions carry, derived from the prompt text itself.
 *
 * Derived deterministically, never model-chosen, for the reason
 * `generation/noteTopics.ts` gives: a model asked to pick topics drifts
 * between synonyms and fragments the vocabulary within a few runs. The prompt
 * as one slug keeps every run of "History of the Whig party" under one chip.
 */
export function promptTopics(prompt: string): string[] {
  const topics = normalizeTopics([prompt]);
  return topics.length > 0 ? topics : [FALLBACK_PROMPT_TOPIC];
}

export type PromptValidation =
  | { ok: true; prompt: string; slug: string }
  | { ok: false; reason: string };

/**
 * The entire input-validation surface for a typed prompt.
 *
 * Loose on purpose — a prompt is free text and almost anything is worth
 * sending. The bounds exist to catch what is clearly a slip: empty input, and
 * something long enough that it was probably pasted rather than asked.
 */
export function validatePrompt(raw: string): PromptValidation {
  const prompt = raw.trim().replace(/\s+/g, ' ');

  if (!prompt) return { ok: false, reason: 'Describe what to ask about first.' };
  if (prompt.length < 3) return { ok: false, reason: 'Say a little more than that.' };
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, reason: `Keep it under ${MAX_PROMPT_CHARS} characters — a subject, not an essay.` };
  }

  const slug = promptSlug(prompt);
  if (!slug || !/[a-z0-9]/.test(slug)) {
    return { ok: false, reason: "That doesn't look like a subject." };
  }

  return { ok: true, prompt, slug };
}
