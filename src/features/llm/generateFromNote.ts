import { AppError } from '../../lib/errors';
import type { ParsedNote } from '../../notes/parse';
import { sectionText } from '../../notes/parse';
import { noteFilename } from '../../notes/paths';
import { topicsForNote } from '../../quiz/generation/noteTopics';
import type { Question } from '../../quiz/types';
import { GENERATION_EFFORT, type LlmProviderDefinition } from './contract';
import { parseQuestions, type RejectedQuestion } from './parseQuestions';
import { buildSystemPrompt, buildUserPrompt, type UserPromptOptions } from './prompt';

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
  /** A CEILING on questions for this request. The model decides the real number. */
  count: number;
  /** Set when this request covers only part of a note — see `chunkNote`. */
  prompt?: UserPromptOptions;
  /**
   * The reader's own generation instructions from Settings.
   *
   * Passed in rather than read from the store here, so this function stays
   * testable with no stores at all — and so the Settings "Test" button can send
   * the draft the user is looking at.
   */
  guidance?: string;
  /**
   * Fired as soon as the provider replies, BEFORE the reply is judged usable.
   *
   * Tokens are billed whether or not we can parse what came back, so a caller
   * summing usage from the return value alone under-reports every failure.
   */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
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

/**
 * Room for the model to think before it writes anything.
 *
 * On a REASONING model `maxTokens` covers internal reasoning as well as the
 * reply. A budget sized for the JSON alone gets consumed by thinking before a
 * single visible character is emitted, and that arrives as an empty completion
 * with a "length" stop — not as an error, and not as anything the parser can
 * make sense of. This is a FLAT allowance rather than something scaled per
 * question, because thinking about a note is roughly the same job whether the
 * answer runs to five questions or twenty.
 */
const REASONING_HEADROOM = 8_000;

/**
 * Output tokens one question's JSON actually costs. MEASURED, at last.
 *
 * This used to be 1,600, which was never a measurement — it was 8,000 (the old
 * floor) divided by the five questions a note produced back then, and the floor
 * was doing all the work. Reasoning from it was circular.
 *
 * A real run over the vault reported 7,122 output tokens for 20 questions
 * across two requests: ~356 tokens per question INCLUDING each call's share of
 * reasoning. 400 is that, rounded up, and it sits on top of the flat headroom
 * above rather than having to absorb the thinking itself — so the true margin
 * at twenty questions is better than 2x.
 *
 * The old figure being 4x too fat is exactly why the per-call ceiling was stuck
 * at ten: `10 * 1_600` already exhausted the cap.
 */
const TOKENS_PER_QUESTION = 400;

/**
 * An absolute ceiling, because the model id is a free-text field in Settings.
 *
 * We cannot know a given model's maximum output, and asking for more than it
 * allows is not a bigger budget — it is an HTTP 400. That arrives as
 * `llm_bad_response`, which is NOT in `llmGenerator`'s abort list, so every
 * note in the run would fail the same way.
 *
 * 16,000 deliberately UNCHANGED while the question ceiling doubled. It is the
 * one number here that risks a hard failure on an older model rather than a
 * merely tighter budget, and the re-derivation above bought the extra questions
 * without needing to touch it. It still agrees exactly with
 * `REASONING_HEADROOM + MAX_QUESTIONS_PER_CALL * TOKENS_PER_QUESTION`, which is
 * the invariant that keeps the two ceilings from silently truncating each other.
 */
export const MAX_TOKEN_BUDGET = 16_000;

export function tokenBudget(count: number): number {
  return Math.min(MAX_TOKEN_BUDGET, REASONING_HEADROOM + count * TOKENS_PER_QUESTION);
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
    system: buildSystemPrompt(input.guidance),
    // The vault filename verbatim, not `note.title` — see `noteFilename`.
    user: buildUserPrompt(note, count, noteFilename(path), input.prompt),
    maxTokens: tokenBudget(count),
    json: true,
    effort: GENERATION_EFFORT,
    signal,
  });
  const elapsedMs = Date.now() - startedAt;

  // Before any of the checks below, all of which can throw. Those tokens were
  // billed regardless of whether we end up able to use the reply.
  input.onUsage?.(completion.usage);

  /*
    A reply cut off at the token cap produces JSON that cannot close, and
    "invalid JSON" would send someone looking in entirely the wrong place. Name
    the actual cause instead.
  */
  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message:
        completion.text.length === 0
          ? `${model} used its entire output budget without returning anything. Reasoning models spend part of that budget thinking — try a faster model, or a shorter note.`
          : `${model} was cut off before finishing this part of the note.`,
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
