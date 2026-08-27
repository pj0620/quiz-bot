import { AppError } from '../../lib/errors';
import { VOCAB_SOURCE_ID, VOCAB_TOPIC, vocabPath } from '../../quiz/vocab/types';
import type { Question } from '../../quiz/types';
import type { LlmProviderDefinition } from './contract';
import { tokenBudget } from './generateFromNote';
import { extractJson, parseQuestions, type RejectedQuestion } from './parseQuestions';
import { buildVocabSystemPrompt, buildVocabUserPrompt } from './vocabPrompt';

/**
 * One word in, a small set of questions and a dictionary entry out.
 *
 * Built on the SAME parser as note generation, for the reason `reviseQuestion`
 * gives: a question arriving from a model is exactly what `parseQuestions`
 * exists to validate, and a looser second path would let the bank hold shapes
 * generation could never produce.
 *
 * One request, not two. The definition shown in the word list and the questions
 * written about the word must describe the SAME sense — two calls can disagree,
 * and a definition contradicting the question beneath it is invisible until a
 * reader hits it. Asking for both in one reply is also half the latency and
 * half the cost per word. It works because `parseQuestions` reads the
 * `questions` key and ignores its siblings, so extra root keys ride along free.
 */

/** The reply carries a dictionary entry alongside the questions. */
type VocabEnvelope = {
  definition?: string;
  partOfSpeech?: string;
  unknown?: boolean;
};

export type GenerateVocabQuestionsInput = {
  word: string;
  slug: string;
  /** The reader's own gloss, if they wrote one. Steers which sense is used. */
  definition?: string;
  /** A CEILING. How many the word is worth is the model's judgement. */
  count: number;
  /** Prompts already in the bank for this word, so a re-run adds new angles. */
  alreadyAsked?: readonly string[];
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  guidance?: string;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  now?: number;
  signal?: AbortSignal;
};

export type GenerateVocabQuestionsResult = {
  questions: Question[];
  rejected: RejectedQuestion[];
  /** The sense the questions were actually written against. */
  definition?: string;
  partOfSpeech?: string;
  /** The model did not recognise the word. Questions will be empty. */
  unknown: boolean;
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
};

/** What the word list shows. Long enough for a sentence, short enough to store. */
const MAX_DEFINITION_CHARS = 300;

/**
 * Reads the dictionary entry off the root of the reply.
 *
 * Separate from `parseQuestions` and forgiving by design: a missing definition
 * is a cosmetic loss (the word list shows the reader's own note, or nothing),
 * whereas throwing here would discard a reply full of perfectly good questions.
 */
export function parseVocabEnvelope(text: string): VocabEnvelope {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const row = parsed as Record<string, unknown>;
  const definition = typeof row.definition === 'string' ? row.definition.trim() : '';
  const partOfSpeech = typeof row.partOfSpeech === 'string' ? row.partOfSpeech.trim() : '';

  return {
    ...(definition ? { definition: definition.slice(0, MAX_DEFINITION_CHARS) } : {}),
    ...(partOfSpeech ? { partOfSpeech } : {}),
    ...(row.unknown === true ? { unknown: true } : {}),
  };
}

export async function generateVocabQuestions(
  input: GenerateVocabQuestionsInput,
): Promise<GenerateVocabQuestionsResult> {
  const { word, slug, provider, apiKey, model, count, signal } = input;
  const now = input.now ?? Date.now();

  if (!apiKey) throw new AppError('llm_not_configured');

  const startedAt = Date.now();
  const completion = await provider.complete({
    apiKey,
    model,
    system: buildVocabSystemPrompt(input.guidance),
    user: buildVocabUserPrompt({
      word,
      ...(input.definition ? { definition: input.definition } : {}),
      count,
      ...(input.alreadyAsked ? { alreadyAsked: input.alreadyAsked } : {}),
    }),
    // The same measured budget the note path uses — a question costs what a
    // question costs, whatever prompted it.
    maxTokens: tokenBudget(count),
    json: true,
    signal,
  });
  const elapsedMs = Date.now() - startedAt;

  // Before anything that can throw: those tokens were billed either way.
  input.onUsage?.(completion.usage);

  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message: `${model} was cut off before finishing "${word}".`,
    });
  }

  const envelope = parseVocabEnvelope(completion.text);
  const definition = envelope.definition ?? input.definition;

  /*
    Everything that must be CONSISTENT is assigned here rather than trusted to
    the model — the same division of labour `parseQuestions` documents.

    `path` is the load-bearing one: it namespaces this word's ids, so two words
    never collide and the same word re-run produces the same ids and dedupes in
    `addQuestions`.

    The definition also rides along as the excerpt. It costs a few hundred
    characters per question and makes a question readable on its own: the detail
    screen can show what the word means with no ledger lookup, and it still
    reads correctly if the word row is later removed.
  */
  const { questions, rejected } = parseQuestions(completion.text, {
    sourceId: VOCAB_SOURCE_ID,
    path: vocabPath(slug),
    noteTitle: word,
    topics: [VOCAB_TOPIC],
    excerpt: definition ?? '',
    addedAt: now,
  });

  /*
    Strip any anchor the model volunteered.

    The prompt does not ask for "source", but a model that has seen ten thousand
    of these will sometimes send one anyway — and `parseQuestions` copies it
    into `provenance.quote` without asking who wanted it. A vocab question
    carrying a quote makes the detail screen offer "Read the full note", which
    resolves a source called 'vocab', finds nothing, and fails in the reader's
    face. The invariant is worth holding at the data layer rather than relying
    on every screen to remember it.
  */
  const anchorless = questions.map((question) => {
    if (!question.provenance.quote) return question;
    const { quote: _quote, ...provenance } = question.provenance;
    return { ...question, provenance };
  });

  if (questions.length === 0 && !envelope.unknown) {
    throw new AppError('llm_bad_response', {
      message:
        rejected.length > 0
          ? `The model returned ${rejected.length} question${rejected.length === 1 ? '' : 's'} for "${word}", none usable (${rejected[0].reason}).`
          : `The model returned no questions for "${word}".`,
    });
  }

  return {
    questions: anchorless,
    rejected,
    ...(definition ? { definition } : {}),
    ...(envelope.partOfSpeech ? { partOfSpeech: envelope.partOfSpeech } : {}),
    unknown: envelope.unknown === true,
    usage: completion.usage,
    elapsedMs,
  };
}
