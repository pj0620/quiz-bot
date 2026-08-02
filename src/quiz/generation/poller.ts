import { getLlmSettings } from '../../features/llm/settings';
import { getSourceType } from '../../sources/registry';
import { getSources } from '../../sources/store';
import type { InfoSource } from '../../sources/types';
import { addQuestions, getQuestions } from '../store';
import { recordCoverage, recordFailure } from './coverageStore';
import { createLlmGenerator } from './llmGenerator';
import { noteGenerator } from './noteGenerator';
import type { NoteGenerationEvent, QuestionGenerator } from './contract';

/**
 * Runs generation over the connected sources.
 *
 * The generators produce; this owns the consequences — saving questions,
 * recording coverage, forwarding progress. Keeping side effects here is what
 * lets a generator be tested with a fake provider and no stores at all.
 */

const DEFAULT_TARGET_QUESTIONS = 25;

/**
 * Cost ceiling per source, independent of the question target.
 *
 * Each note is one provider request plus one model call, so a high target over
 * short notes could otherwise run for a long time and spend real money.
 */
const DEFAULT_MAX_NOTES = 8;

export type RunProgress = {
  event: NoteGenerationEvent;
  /** Questions saved across the whole run so far. */
  addedSoFar: number;
  notesDone: number;
};

export type RunOptions = {
  targetQuestions?: number;
  maxNotes?: number;
  folders?: string[];
  signal?: AbortSignal;
  now?: number;
  onProgress?: (progress: RunProgress) => void;
};

export type PollResult = {
  added: number;
  notesScanned: number;
  /** Total markdown notes across all sources. Zero means nothing to quiz on. */
  notesAvailable: number;
  /** Notes skipped because they were already covered at their current version. */
  notesCovered: number;
  sourcesPolled: number;
  usage: { inputTokens: number; outputTokens: number };
  errors: { sourceId: string; message: string }[];
};

let override: QuestionGenerator | null = null;

/** Test seam. Production selects the generator from settings instead. */
export function setGenerator(next: QuestionGenerator | null): void {
  override = next;
}

/** Resolves what runs, from the user's choice in Settings. */
export function resolveGenerator(): QuestionGenerator {
  if (override) return override;
  const { generatorId } = getLlmSettings();
  return generatorId === 'mock' ? noteGenerator : createLlmGenerator(generatorId);
}

export function getGeneratorName(): string {
  return resolveGenerator().name;
}

export async function pollSource(
  source: InfoSource,
  options: RunOptions = {},
): Promise<{ added: number; notesScanned: number; notesAvailable: number; notesCovered: number; usage: { inputTokens: number; outputTokens: number } }> {
  const definition = getSourceType(source);
  const existingIds = new Set(getQuestions().map((question) => question.id));
  const generator = resolveGenerator();

  let added = 0;
  let notesDone = 0;

  const result = await generator.generate({
    source,
    provider: definition.provider,
    targetQuestions: options.targetQuestions ?? DEFAULT_TARGET_QUESTIONS,
    maxNotes: options.maxNotes ?? DEFAULT_MAX_NOTES,
    folders: options.folders,
    existingIds,
    signal: options.signal,
    now: options.now,

    /*
      Saved per note, not at the end.

      Generation costs money per note, so a run cancelled halfway must keep
      everything already paid for. Recording coverage here too means a
      cancelled run's completed notes are not re-read on the next attempt.
    */
    onNote: (event) => {
      notesDone += 1;

      if (event.error) {
        // Only generators that consult coverage may write to it — see
        // `tracksCoverage`. Recording a mock run would make the LLM skip notes
        // it has never seen.
        if (generator.tracksCoverage) {
          recordFailure({
            sourceId: source.id,
            path: event.path,
            message: event.error.message,
          });
        }
      } else {
        added += addQuestions(event.questions).added;
        if (generator.tracksCoverage) {
          recordCoverage({
            sourceId: source.id,
            path: event.path,
            contentHash: event.contentHash,
            questionCount: event.questions.length,
            now: options.now,
          });
        }
      }

      options.onProgress?.({ event, addedSoFar: added, notesDone });
    },
  });

  return {
    added,
    notesScanned: result.notesScanned,
    notesAvailable: result.notesAvailable,
    notesCovered: result.notesCovered ?? 0,
    usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
  };
}

export async function pollAllSources(options: RunOptions = {}): Promise<PollResult> {
  const sources = getSources();
  const result: PollResult = {
    added: 0,
    notesScanned: 0,
    notesAvailable: 0,
    notesCovered: 0,
    sourcesPolled: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    errors: [],
  };

  for (const source of sources) {
    if (options.signal?.aborted) break;
    try {
      const outcome = await pollSource(source, options);
      result.added += outcome.added;
      result.notesScanned += outcome.notesScanned;
      result.notesAvailable += outcome.notesAvailable;
      result.notesCovered += outcome.notesCovered;
      result.usage.inputTokens += outcome.usage.inputTokens;
      result.usage.outputTokens += outcome.usage.outputTokens;
      result.sourcesPolled += 1;
    } catch (error) {
      // One unreachable source must not stop the others.
      result.errors.push({
        sourceId: source.id,
        message: error instanceof Error ? error.message : 'Generation failed',
      });
    }
  }

  return result;
}
