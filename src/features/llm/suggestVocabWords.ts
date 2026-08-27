import { AppError } from '../../lib/errors';
import { vocabSlug } from '../../quiz/vocab/types';
import type { LlmProviderDefinition } from './contract';
import { extractJson } from './parseQuestions';
import { buildSuggestSystemPrompt, buildSuggestUserPrompt } from './vocabPrompt';

/**
 * "Suggest me ten words worth learning."
 *
 * Deliberately NOT routed through `parseQuestions` — these are not questions,
 * and forcing them through a validator built for a different shape would only
 * obscure what is actually being checked.
 *
 * Unlike `gradeShortAnswer`, which swallows every error and returns null, this
 * one throws. Grading has a graceful fallback (the user grades themselves);
 * "suggest me some words" has none, and an empty list returned silently looks
 * like the model had nothing to say rather than like a failure.
 */

export type VocabSuggestion = {
  word: string;
  definition: string;
  partOfSpeech?: string;
};

export type SuggestVocabWordsInput = {
  count: number;
  /** The theme the reader picked, in their own words. */
  theme?: string;
  /** Topics from their bank — sent only for the notes-aware theme. */
  topics?: readonly string[];
  /** Words already in the ledger, so the model doesn't repeat them. */
  avoid: readonly string[];
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
};

export type SuggestVocabWordsResult = {
  words: VocabSuggestion[];
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * A list of words is a few hundred tokens; the rest is reasoning headroom.
 * Flat, like `reviseQuestion`'s — there is no per-item cost model worth having
 * for a request whose output is this small.
 */
const SUGGEST_TOKEN_BUDGET = 4_000;

const MAX_SUGGESTION_CHARS = 300;

/**
 * Exported for its test. Drops a bad row, never the batch — the same policy
 * every other parser in this app follows.
 */
export function parseSuggestions(text: string, avoid: readonly string[] = []): VocabSuggestion[] {
  const parsed = extractJson(text);
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { words?: unknown }).words)
      ? ((parsed as { words: unknown[] }).words)
      : null;

  if (!rows) return [];

  // Belt and braces: the model WILL occasionally return a word it was asked to
  // avoid, and the ledger would reject it anyway — better to not show it.
  const seen = new Set(avoid.map(vocabSlug));
  const suggestions: VocabSuggestion[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;

    const word = typeof entry.word === 'string' ? entry.word.trim() : '';
    const definition = typeof entry.definition === 'string' ? entry.definition.trim() : '';
    if (!word || !definition) continue;

    const slug = vocabSlug(word);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const partOfSpeech = typeof entry.partOfSpeech === 'string' ? entry.partOfSpeech.trim() : '';
    suggestions.push({
      word,
      definition: definition.slice(0, MAX_SUGGESTION_CHARS),
      ...(partOfSpeech ? { partOfSpeech } : {}),
    });
  }

  return suggestions;
}

export async function suggestVocabWords(
  input: SuggestVocabWordsInput,
): Promise<SuggestVocabWordsResult> {
  const { provider, apiKey, model, count, avoid, signal } = input;

  if (!apiKey) throw new AppError('llm_not_configured');

  const completion = await provider.complete({
    apiKey,
    model,
    system: buildSuggestSystemPrompt(),
    /*
      The reader's generation guidance is deliberately NOT sent.

      It is instruction about how QUESTIONS should be pitched — "ask why more
      often than when", "skip anything about statistics". Applied to a word
      list it means nothing, and a model handed it anyway would read it as an
      instruction about which words to pick. The theme is the steering here.
    */
    user: buildSuggestUserPrompt({
      count,
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.topics ? { topics: input.topics } : {}),
      avoid,
    }),
    maxTokens: SUGGEST_TOKEN_BUDGET,
    json: true,
    signal,
  });

  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message: `${model} was cut off before finishing the list. Try asking for fewer words.`,
    });
  }

  const words = parseSuggestions(completion.text, avoid);
  if (words.length === 0) {
    throw new AppError('llm_bad_response', {
      message: 'The model suggested no usable words. Try again, or change the theme.',
    });
  }

  return { words, usage: completion.usage };
}
