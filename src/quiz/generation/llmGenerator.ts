import { resolveCredentials } from '../../features/llm/credentials';
import { generateNoteInParts } from '../../features/llm/generateNoteInParts';
import { getGuidance } from '../../features/llm/settings';
import { toAppError } from '../../lib/errors';
import { forEachInPool } from '../../lib/pool';
import { parseNote } from '../../notes/parse';
import { noteFilename, noteStem } from '../../notes/paths';
import type { LlmProviderId } from '../../features/llm/types';
import type { Question } from '../types';
import { getCoverage } from './coverageStore';
import { selectNotes, toCandidates } from './selectNotes';
import type { GenerationInput, GenerationResult, PlannedNote, QuestionGenerator } from './contract';

/**
 * The paid generation loop: pick a note, generate from it, repeat — with a few
 * notes in flight at a time.
 *
 * The NOTE remains the unit of work whatever the concurrency. It fits
 * comfortably in context, is cheap enough to retry, and is the natural thing to
 * attribute provenance to — but the real reason is cost control. Batching
 * everything into one request would mean a single failure wastes the whole run,
 * and there would be no moment at which the user could stop it.
 *
 * Parallelism is worth having because a run is almost entirely spent waiting:
 * the app is idle between sending a note and the model replying, and nothing
 * about a note depends on any other note.
 *
 * Three invariants hold the whole thing together:
 *
 *  - `onNote` fires after EVERY note, success or failure, so the caller can
 *    save immediately. Cancelling then keeps everything already paid for.
 *  - A note that fails does not end the run. `generateNoteInParts` throws when
 *    nothing usable came back from any of its requests, and one unparseable
 *    note must not abort a run the user is being charged for.
 *  - Every mutation of shared state below happens synchronously between awaits.
 *    JavaScript gives us that for free, and it is what makes running several
 *    notes at once safe without any locking.
 */

export function createLlmGenerator(providerId: LlmProviderId): QuestionGenerator {
  return {
    name: providerId,
    tracksCoverage: true,

    async generate(input: GenerationInput): Promise<GenerationResult> {
      const { source, provider: content, targetQuestions, maxNotes, folders, onNote, signal } = input;
      const now = input.now ?? Date.now();

      // Fail before spending anything on a listing if there's no key.
      const { provider, apiKey, model } = await resolveCredentials(providerId);

      /*
        Read ONCE, here, rather than per note.

        A run takes minutes and the user can edit this in Settings while it is
        going. Re-reading per note would mean a single run generated against two
        different sets of instructions, with no way to tell afterwards which
        note got which — so the run uses whatever was set when it started.
      */
      const guidance = getGuidance();

      const listing = await content.listFiles(source, signal);
      const candidates = toCandidates(source.id, listing.files);

      const { selected, counts } = selectNotes({
        candidates,
        coverage: getCoverage(),
        filters: folders?.length ? { folders } : undefined,
        limit: maxNotes,
        seed: source.id,
      });

      const planned: PlannedNote[] = selected.map((note) => ({
        sourceId: source.id,
        path: note.path,
        noteTitle: noteFilename(note.path),
      }));
      input.onPlan?.(planned);

      const questions: Question[] = [];
      const usage = { inputTokens: 0, outputTokens: 0 };
      let notesScanned = 0;
      let stopped = false;

      /*
        Checked before a lane claims another note rather than inside the work.

        `targetQuestions` can only be honoured between notes: a note in flight
        has already been paid for, and there is no way to record half of one.
        With several lanes running this means the target is overshot by up to
        one note per lane, which is the price of not throwing away paid work.
      */
      const shouldStop = () =>
        stopped ||
        signal?.aborted === true ||
        (targetQuestions !== undefined && questions.length >= targetQuestions);

      await forEachInPool(
        selected,
        input.concurrency ?? 1,
        async (note, index) => {
          input.onNoteStart?.(planned[index]);

          try {
            /*
              Pinned to the revision the listing resolved.

              The blob hash recorded for this note comes from that same listing,
              so reading at a moving branch ref could pair content from one commit
              with a hash from another — marking the note covered at a version
              nobody ever read.
            */
            const raw = await content.readFile(source, note.path, {
              ref: listing.revision,
              signal,
            });

            const parsed = parseNote(raw, noteStem(note.path));

            /*
              How many questions this note is worth is the model's judgement, made
              from the material — there is no count passed in here any more. What
              IS decided up front is how much material to show it at a time, since
              one request can only be relied on to produce so many questions before
              risking being cut off, and a cut-off reply is discarded whole.

              `generateNoteInParts` may therefore send several requests, but it
              always returns once. That is deliberate and load-bearing: the event
              below fires once per note, and the coverage ledger has no way to
              express a note that was only half generated from.
            */
            const outcome = await generateNoteInParts({
              note: parsed,
              path: note.path,
              sourceId: source.id,
              revision: listing.revision,
              provider,
              apiKey,
              model,
              guidance,
              now,
              signal,
            });

            notesScanned += 1;
            questions.push(...outcome.questions);
            usage.inputTokens += outcome.usage.inputTokens;
            usage.outputTokens += outcome.usage.outputTokens;

            onNote?.({
              path: note.path,
              noteTitle: noteFilename(note.path),
              contentHash: note.contentHash,
              questions: outcome.questions,
              usage: outcome.usage,
              modelCalls: outcome.modelCalls,
            });

            // Emitted first, so cancelling keeps the parts already paid for.
            if (outcome.aborted) stopped = true;
          } catch (error) {
            const appError = toAppError(error);

            /*
              An aborted request is the user pressing Cancel, not a failed note.
              Recording it as a failure would count towards the give-up threshold
              and eventually make a perfectly good note unreachable.
            */
            if (signal?.aborted) {
              stopped = true;
              return;
            }

            notesScanned += 1;
            onNote?.({
              path: note.path,
              noteTitle: noteFilename(note.path),
              contentHash: note.contentHash,
              questions: [],
              error: appError,
            });

            /*
              Auth and quota failures will hit every remaining note identically,
              so continuing would just burn through the list producing the same
              error. Everything else is note-specific and worth moving past.

              Thrown rather than flagged, because the pool re-throws it to the
              caller — and this has to reach the screen as an error rather than
              looking like a run that simply finished early.
            */
            if (
              appError.code === 'llm_unauthorized' ||
              appError.code === 'llm_quota_exceeded' ||
              appError.code === 'llm_not_configured'
            ) {
              throw appError;
            }
          }
        },
        { stop: shouldStop },
      );

      return {
        questions,
        notesScanned,
        notesAvailable: candidates.length,
        notesCovered: counts.covered,
        usage,
        revision: listing.revision,
      };
    },
  };
}
