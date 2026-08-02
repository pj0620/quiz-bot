import { AppError } from '../../lib/errors';
import type { ParsedNote } from '../../notes/parse';
import { sectionText } from '../../notes/parse';
import { topicsForNote } from '../../quiz/generation/noteTopics';
import type { Question } from '../../quiz/types';
import type { LlmProviderDefinition } from './contract';
import { parseQuestions, type RejectedQuestion } from './parseQuestions';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

/**
 * One note in, questions out.
 *
 * This is the whole LLM generation path, and it is deliberately the unit: a
 * single note is small enough to fit comfortably in context, cheap enough to
 * retry, and the natural thing to attribute provenance to. Choosing WHICH notes
 * to run this over, and how many times, is a separate concern that sits above
 * this function.
 */

export type GenerateFromNoteInput = {
  note: ParsedNote;
  /** Repository path, for provenance and for the deterministic id. */
  path: string;
  sourceId: string;
  revision?: string;
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  count: number;
  now?: number;
  signal?: AbortSignal;
};

export type GenerateFromNoteResult = {
  questions: Question[];
  /** Rows the model returned that couldn't be used, with the reason. */
  rejected: RejectedQuestion[];
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
};

/** Room for the JSON of `count` questions, with headroom for explanations. */
function tokenBudget(count: number): number {
  return Math.max(1024, count * 400);
}

/** What "From your notes" shows under a question. */
const MAX_EXCERPT_CHARS = 600;

export async function generateFromNote(input: GenerateFromNoteInput): Promise<GenerateFromNoteResult> {
  const { note, path, sourceId, provider, apiKey, model, count, signal } = input;
  const now = input.now ?? Date.now();

  if (!apiKey) throw new AppError('llm_not_configured');

  const startedAt = Date.now();
  const completion = await provider.complete({
    apiKey,
    model,
    system: buildSystemPrompt(),
    user: buildUserPrompt(note, count),
    maxTokens: tokenBudget(count),
    json: true,
    signal,
  });
  const elapsedMs = Date.now() - startedAt;

  /*
    A reply cut off at the token cap produces JSON that cannot close, and
    "invalid JSON" would send someone looking in entirely the wrong place. Name
    the actual cause instead.
  */
  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message: `${model} hit its output limit before finishing. Try asking for fewer questions.`,
    });
  }

  /*
    Provenance points at the note, not at a passage: the whole note is sent, so
    which section a given question came from isn't known. Per-section
    attribution would mean per-section requests — a real option later, at the
    cost of many more calls.
  */
  const excerpt = note.sections
    .map((section) => sectionText(section))
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_EXCERPT_CHARS);

  const { questions, rejected } = parseQuestions(completion.text, {
    sourceId,
    path,
    noteTitle: note.title,
    topics: topicsForNote(note, path),
    revision: input.revision,
    excerpt,
    addedAt: now,
  });

  // A reply that parsed but yielded nothing usable is a failure worth naming —
  // silently returning zero questions looks identical to "nothing new".
  if (questions.length === 0) {
    throw new AppError('llm_bad_response', {
      message:
        rejected.length > 0
          ? `The model returned ${rejected.length} question${rejected.length === 1 ? '' : 's'}, none usable (${rejected[0].reason}).`
          : 'The model returned no questions.',
    });
  }

  return { questions, rejected, usage: completion.usage, elapsedMs };
}
