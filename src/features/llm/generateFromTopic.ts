import { AppError } from '../../lib/errors';
import { PROMPT_SOURCE_ID, promptPath, promptTopics } from '../../quiz/promptSource';
import type { Question } from '../../quiz/types';
import { GENERATION_EFFORT, type LlmProviderDefinition } from './contract';
import { tokenBudget } from './generateFromNote';
import { parseQuestions, type RejectedQuestion } from './parseQuestions';
import { buildTopicSystemPrompt, buildTopicUserPrompt } from './topicPrompt';

/**
 * One typed subject in, a set of questions out.
 *
 * Built on the SAME parser as note and vocabulary generation, for the reason
 * `generateVocabQuestions` gives: a question arriving from a model is exactly
 * what `parseQuestions` exists to validate, and a looser second path would let
 * the bank hold shapes generation could never produce.
 *
 * One request per run. A subject has no natural parts the way a long note
 * does, and the count is a bounded ceiling — so unlike note generation there
 * is nothing to chunk and nothing to resume. Cancel aborts the single request
 * and nothing is saved.
 */

export type GenerateFromTopicInput = {
  /** The subject as the reader typed it, already through `validatePrompt`. */
  subject: string;
  /** Identity — namespaces this subject's question ids. See `promptSlug`. */
  slug: string;
  /** A CEILING. How many the subject is worth is the model's judgement. */
  count: number;
  /** Prompts already in the bank for this subject, so a re-run adds new angles. */
  alreadyAsked?: readonly string[];
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  guidance?: string;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  now?: number;
  signal?: AbortSignal;
};

export type GenerateFromTopicResult = {
  questions: Question[];
  rejected: RejectedQuestion[];
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
};

export async function generateFromTopic(
  input: GenerateFromTopicInput,
): Promise<GenerateFromTopicResult> {
  const { subject, slug, provider, apiKey, model, count, signal } = input;
  const now = input.now ?? Date.now();

  if (!apiKey) throw new AppError('llm_not_configured');

  const startedAt = Date.now();
  const completion = await provider.complete({
    apiKey,
    model,
    system: buildTopicSystemPrompt(input.guidance),
    user: buildTopicUserPrompt({
      subject,
      count,
      ...(input.alreadyAsked ? { alreadyAsked: input.alreadyAsked } : {}),
    }),
    // The same measured budget the note path uses — a question costs what a
    // question costs, whatever prompted it.
    maxTokens: tokenBudget(count),
    json: true,
    // The same thinking budget as writing from a note: here the model is also
    // CHOOSING the material, which is not a smaller job.
    effort: GENERATION_EFFORT,
    signal,
  });
  const elapsedMs = Date.now() - startedAt;

  // Before anything that can throw: those tokens were billed either way.
  input.onUsage?.(completion.usage);

  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message:
        completion.text.length === 0
          ? `${model} used its entire output budget without returning anything. Reasoning models spend part of that budget thinking — try a faster model or fewer questions.`
          : `${model} was cut off before finishing.`,
    });
  }

  /*
    Everything that must be CONSISTENT is assigned here rather than trusted to
    the model — the division of labour `parseQuestions` documents.

    `path` namespaces this subject's ids, so re-running "History of the Whig
    party" produces the same ids for the same questions and dedupes in
    `addQuestions`. The subject itself rides along as `noteTitle` and
    `excerpt`, which is what the provenance cards show.
  */
  const { questions, rejected } = parseQuestions(completion.text, {
    sourceId: PROMPT_SOURCE_ID,
    path: promptPath(slug),
    noteTitle: subject,
    topics: promptTopics(subject),
    excerpt: subject,
    addedAt: now,
  });

  /*
    Strip the note-shaped provenance the parser copies in unasked.

    `quote` for the reason `generateVocabQuestions` gives: a model that has
    seen ten thousand anchored requests sometimes sends "source" anyway.
    `path` because `NoteSource` offers "Read the full note" to anything that
    carries one, and tapping it would resolve a source called 'prompt', find
    nothing, and fail in the reader's face. The id was already hashed from the
    path above, so identity survives the strip.
  */
  const stripped = questions.map((question) => {
    const { quote: _quote, path: _path, ...provenance } = question.provenance;
    return { ...question, provenance };
  });

  if (questions.length === 0) {
    throw new AppError('llm_bad_response', {
      message:
        rejected.length > 0
          ? `The model returned ${rejected.length} question${rejected.length === 1 ? '' : 's'}, none usable (${rejected[0].reason}).`
          : 'The model returned no questions.',
    });
  }

  return { questions: stripped, rejected, usage: completion.usage, elapsedMs };
}
