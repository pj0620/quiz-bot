import { toAppError } from '../../lib/errors';
import { chunkNote, noteOutline } from '../../quiz/generation/chunkNote';
import type { Question } from '../../quiz/types';
import { generateFromNote, type GenerateFromNoteInput } from './generateFromNote';
import type { RejectedQuestion } from './parseQuestions';

/**
 * One note, however many requests it takes.
 *
 * Kept separate from `generateFromNote` on purpose. That function has one job —
 * one request, all-or-nothing, throw on failure — and it is easier to trust for
 * being that small. Partial success, cancellation part-way through, and summing
 * what several requests cost are a different job with different rules.
 *
 * The rule that shapes everything here: the caller must still see EXACTLY ONE
 * result per note. `NoteGenerationEvent` is emitted once per note, and the
 * coverage ledger keyed on `sourceId:path` has no concept of a partial note —
 * `recordCoverage` replaces the row rather than adding to it, and
 * `recordFailure` keeps the previous content hash. A second event for the same
 * note would either lose a count or mark a half-generated note as covered
 * forever. So splitting stays entirely inside this function.
 */

/**
 * Ceiling per request. Agrees with `MAX_TOKEN_BUDGET` — see `tokenBudget`.
 *
 * Twenty, not the ten this used to be, and the change is not a preference — ten
 * was being hit EXACTLY on note after note. A ceiling that a majority of notes
 * land on is not a ceiling, it is a quota, and it was silently overriding the
 * prompt's instruction to write as many questions as the material is worth.
 *
 * The old ten was never chosen on its merits either. It was whatever fitted
 * inside `MAX_TOKEN_BUDGET` at the inflated 1,600-tokens-per-question estimate;
 * correcting that estimate to the measured cost is what paid for this, with the
 * token cap itself untouched.
 */
export const MAX_QUESTIONS_PER_CALL = 20;

export type GenerateNoteInPartsInput = Omit<GenerateFromNoteInput, 'count' | 'prompt' | 'onUsage'>;

export type GenerateNoteInPartsResult = {
  questions: Question[];
  rejected: RejectedQuestion[];
  /** Summed across every request, including ones that produced nothing. */
  usage: { inputTokens: number; outputTokens: number };
  /** Requests actually sent. 1 for almost every note. */
  modelCalls: number;
  /** Requests that produced nothing usable. */
  failedParts: number;
  /** True when cancellation stopped the note part-way. */
  aborted: boolean;
};

export async function generateNoteInParts(
  input: GenerateNoteInPartsInput,
): Promise<GenerateNoteInPartsResult> {
  const { note, signal } = input;

  const chunks = chunkNote(note);
  const outline = noteOutline(note);

  const questions: Question[] = [];
  const rejected: RejectedQuestion[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const seen = new Set<string>();
  const alreadyAsked: string[] = [];

  let modelCalls = 0;
  let failedParts = 0;
  let aborted = false;
  let firstError: unknown = null;

  for (const [index, chunk] of chunks.entries()) {
    /*
      Checked between parts, and the loop BREAKS rather than throwing.

      Cancelling has to keep whatever has already been paid for. Throwing here
      would discard completed parts of the note along with the one in flight,
      which is the opposite of what pressing Cancel should cost.
    */
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    modelCalls += 1;
    try {
      const outcome = await generateFromNote({
        ...input,
        // Only this part's sections. Everything else about the note — its
        // filename, tags and links — is carried through unchanged.
        note: { ...note, sections: chunk.sections },
        count: MAX_QUESTIONS_PER_CALL,
        prompt:
          chunks.length > 1
            ? { outline, part: { index: index + 1, total: chunks.length }, alreadyAsked: [...alreadyAsked] }
            : undefined,
        // Recorded even when the reply turns out to be unusable, because it was
        // billed either way.
        onUsage: (partUsage) => {
          usage.inputTokens += partUsage.inputTokens;
          usage.outputTokens += partUsage.outputTokens;
        },
      });

      rejected.push(...outcome.rejected);
      for (const question of outcome.questions) {
        // Ids hash the prompt text, and `section` is never set on this path, so
        // two parts landing on the same wording would otherwise be counted
        // twice here even though the bank would only store one.
        if (seen.has(question.id)) continue;
        seen.add(question.id);
        questions.push(question);
        alreadyAsked.push(question.prompt);
      }
    } catch (error) {
      failedParts += 1;
      if (firstError === null) firstError = error;

      /*
        These three are properties of the account, not of the note, so every
        remaining part would fail identically. Stopping immediately is what
        keeps a misconfigured key from burning a request per part.
      */
      const code = toAppError(error).code;
      if (code === 'llm_unauthorized' || code === 'llm_quota_exceeded' || code === 'llm_not_configured') {
        throw error;
      }
    }
  }

  /*
    Nothing usable from any part is a failed note, and throwing is what puts it
    on the existing failure path — recorded, reported, and retried next run.
    Anything at all, however, counts as a success: a note that gave four
    questions out of five parts is still four questions the user did not have.
  */
  if (questions.length === 0 && firstError !== null) throw firstError;

  return { questions, rejected, usage, modelCalls, failedParts, aborted };
}
