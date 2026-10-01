import { AppError } from '../../lib/errors';
import type { ParsedNote } from '../../notes/parse';
import { sectionText } from '../../notes/parse';
import { noteFilename } from '../../notes/paths';
import { specGuidance } from '../../quiz/builder/planSpec';
import type { PlanSpec } from '../../quiz/builder/types';
import { topicsForNote } from '../../quiz/generation/noteTopics';
import type { Question } from '../../quiz/types';
import { GENERATION_EFFORT, type LlmProviderDefinition } from './contract';
import { tokenBudget } from './generateFromNote';
import { parseQuestions, type RejectedQuestion } from './parseQuestions';
import { buildPlanQuestionsUserPrompt } from './planPrompt';
import { buildSystemPrompt } from './prompt';

/**
 * One note in, questions for one quiz plan out.
 *
 * Note generation with the plan laid over it, and deliberately no more than
 * that. The system prompt is `buildSystemPrompt` itself — every rule that
 * makes a question worth asking — with the plan handed in as the reader's
 * guidance, which is placed last and outranks the rest. The note is shown by
 * `buildNoteBlock`, exactly as note generation shows it. So a plan question is
 * held to every standard a note question is, plus the plan.
 *
 * One request per note, never split: a plan asks a note for a handful of
 * questions at a time, which fits a single reply comfortably, and later passes
 * see what was already asked rather than a different slice of the note.
 */

export type GenerateForPlanInput = {
  note: ParsedNote;
  path: string;
  sourceId: string;
  revision?: string;
  planId: string;
  /** The ACCEPTED plan — never a proposal the reader has not agreed to. */
  spec: PlanSpec;
  /** How many to write — the plan's density, or less for a sample. */
  count: number;
  /** Prompts this plan already has from this note. */
  alreadyAsked?: readonly string[];
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  /** The reader's general guidance from Settings, applied under the plan. */
  guidance?: string;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  now?: number;
  signal?: AbortSignal;
};

export type GenerateForPlanResult = {
  /** Stamped with the plan's id. May be empty when nothing in the note fits. */
  questions: Question[];
  rejected: RejectedQuestion[];
  /** Questions dropped for being in a format the plan does not allow. */
  offPlan: number;
  usage: { inputTokens: number; outputTokens: number };
};

const MAX_EXCERPT_CHARS = 600;

export async function generateForPlan(input: GenerateForPlanInput): Promise<GenerateForPlanResult> {
  const { note, path, sourceId, spec, count, provider, apiKey, model, signal } = input;
  const now = input.now ?? Date.now();

  if (!apiKey) throw new AppError('llm_not_configured');

  const completion = await provider.complete({
    apiKey,
    model,
    system: buildSystemPrompt(specGuidance(spec, input.guidance)),
    user: buildPlanQuestionsUserPrompt({
      note,
      filename: noteFilename(path),
      count,
      ...(input.alreadyAsked ? { alreadyAsked: input.alreadyAsked } : {}),
    }),
    maxTokens: tokenBudget(count),
    json: true,
    effort: GENERATION_EFFORT,
    signal,
  });

  // Before anything that can throw: billed either way.
  input.onUsage?.(completion.usage);

  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message:
        completion.text.length === 0
          ? `${model} used its entire output budget without returning anything. Try a faster model.`
          : `${model} was cut off before finishing this note.`,
    });
  }

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

  /*
    The plan's formats are a RULE the reader agreed, not a preference, so a
    question in another format is dropped rather than slipped into a review
    where the reader would have to reject it by hand.
  */
  const allowed = spec.formats.length > 0 ? new Set(spec.formats) : null;
  const onPlan = allowed ? questions.filter((question) => allowed.has(question.format)) : questions;
  const offPlan = questions.length - onPlan.length;

  if (onPlan.length === 0) {
    /*
      An explicitly empty list is an honest answer — nothing in this note fits
      the plan — and is returned as such, so the note is marked read rather
      than retried forever. Anything else that produced nothing is a failure
      worth naming: unreadable rows, or only formats the plan rules out.
    */
    if (rejected.length === 0 && offPlan === 0) {
      return { questions: [], rejected, offPlan, usage: completion.usage };
    }
    throw new AppError('llm_bad_response', {
      message:
        offPlan > 0
          ? `The model wrote only formats this plan doesn't allow (${offPlan} dropped).`
          : `The model returned ${rejected.length} question${rejected.length === 1 ? '' : 's'}, none usable (${rejected[0].reason}).`,
    });
  }

  return {
    questions: onPlan.map((question) => ({ ...question, planId: input.planId })),
    rejected,
    offPlan,
    usage: completion.usage,
  };
}
