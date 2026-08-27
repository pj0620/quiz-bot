import { useMemo, useSyncExternalStore } from 'react';

import { useGeneratorId, useKeyStatus } from '../../features/llm/useLlm';
import { useQuestions } from '../useQuiz';
import type { Question } from '../types';
import { vocabStore } from './store';
import { isVocabQuestion, slugFromPath, type VocabWord } from './types';

/**
 * React bindings for the word ledger.
 *
 * Same discipline as `useQuiz.ts`: subscribe directly so the stored reference
 * comes back unchanged between renders, and put everything that has to allocate
 * behind `useMemo`. A selector returning a fresh array fails the Object.is
 * snapshot check and loops forever.
 *
 * `useVocabList` is where the ledger and the bank are joined. Screens never do
 * that themselves — the question count is derived rather than stored (see
 * `types.ts`), and one place to derive it is the point.
 */

export type VocabEntry = { word: VocabWord; questions: Question[] };

function useVocabRecord(): Record<string, VocabWord> {
  return useSyncExternalStore(
    vocabStore.subscribe,
    () => vocabStore.get().words,
    () => vocabStore.get().words,
  );
}

/** Every word with its current questions, most recently added first. */
export function useVocabList(): VocabEntry[] {
  const words = useVocabRecord();
  const questions = useQuestions();

  return useMemo(() => {
    const bySlug = new Map<string, Question[]>();
    for (const question of questions) {
      if (!isVocabQuestion(question)) continue;
      const slug = slugFromPath(question.provenance.path);
      if (!slug) continue;
      const existing = bySlug.get(slug);
      if (existing) existing.push(question);
      else bySlug.set(slug, [question]);
    }

    return Object.values(words)
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((word) => ({ word, questions: bySlug.get(word.slug) ?? [] }));
  }, [words, questions]);
}

export function useVocabEntry(slug: string | undefined): VocabEntry | undefined {
  const list = useVocabList();
  return useMemo(
    () => (slug ? list.find((entry) => entry.word.slug === slug) : undefined),
    [list, slug],
  );
}

/**
 * The ledger row behind a vocab question, or undefined for anything else.
 *
 * Reads the ledger ALONE, unlike `useVocabEntry` — it is called on the player's
 * hot path, where joining every question in the bank to find one word's
 * definition would be work done on every render of every question, vocab or
 * not. Returns undefined for a word that has since been removed; the question
 * still carries the definition it was written against.
 */
export function useVocabWordFor(question: Question | undefined): VocabWord | undefined {
  const slug =
    question && isVocabQuestion(question) ? slugFromPath(question.provenance.path) : undefined;
  return vocabStore.useSelector((state) => (slug ? state.words[slug] : undefined));
}

/** How many vocab questions are in the bank, for the Library card. */
export function useVocabQuestionCount(): number {
  const questions = useQuestions();
  return useMemo(() => questions.filter(isVocabQuestion).length, [questions]);
}

export function useVocabWordCount(): number {
  return vocabStore.useSelector((state) => Object.keys(state.words).length);
}

/**
 * Whether questions can actually be written right now.
 *
 * Vocabulary is LLM-only: there is no mock generator for it, because with no
 * text to work from a mock would have to invent what a word means — which is
 * worse than offering nothing. Adding a word still works offline, so the
 * screens use this to explain rather than to disable everything.
 */
export function useVocabReady(): boolean {
  const generatorId = useGeneratorId();
  // The hook needs a provider id whatever the generator is; the result is only
  // consulted when a real provider is selected.
  const keyStatus = useKeyStatus(generatorId === 'mock' ? 'anthropic' : generatorId);
  return generatorId !== 'mock' && keyStatus !== 'missing';
}
