import { readApiKey } from '../../features/llm/auth/secureKeyStore';
import type { LlmProviderDefinition } from '../../features/llm/contract';
import { generateFromNote } from '../../features/llm/generateFromNote';
import { getLlmProvider } from '../../features/llm/registry';
import { getModelFor } from '../../features/llm/settings';
import { AppError, toAppError } from '../../lib/errors';
import { parseNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import type { LlmProviderId } from '../../features/llm/types';
import type { Question } from '../types';
import { getCoverage } from './coverageStore';
import { selectNotes, toCandidates } from './selectNotes';
import type { GenerationInput, GenerationResult, QuestionGenerator } from './contract';

/**
 * The paid generation loop: pick a note, generate from it, repeat.
 *
 * One note at a time rather than one big batch. A note fits comfortably in
 * context, is cheap enough to retry, and is the natural unit to attribute
 * provenance to — but the real reason is cost control. Batching everything
 * would mean a single failure wastes the whole run, and there would be no
 * moment at which the user could stop it.
 *
 * Two invariants hold the whole thing together:
 *
 *  - `onNote` fires after EVERY note, success or failure, so the caller can
 *    save immediately. Cancelling then keeps everything already paid for.
 *  - A note that fails does not end the run. `generateFromNote` throws when a
 *    reply yields nothing usable, and one unparseable note must not abort a
 *    run the user is being charged for.
 */

/** How many questions to ask for per note. The model decides how many it returns. */
const QUESTIONS_PER_NOTE = 5;

async function resolveCredentials(
  providerId: LlmProviderId,
): Promise<{ provider: LlmProviderDefinition; apiKey: string; model: string }> {
  const provider = getLlmProvider(providerId);
  const apiKey = await readApiKey(providerId);
  if (!apiKey) {
    throw new AppError('llm_not_configured', {
      message: `Add an ${provider.label} API key in Settings before generating.`,
    });
  }
  return { provider, apiKey, model: getModelFor(providerId) || provider.defaultModel };
}

export function createLlmGenerator(providerId: LlmProviderId): QuestionGenerator {
  return {
    name: providerId,
    tracksCoverage: true,

    async generate(input: GenerationInput): Promise<GenerationResult> {
      const { source, provider: content, targetQuestions, maxNotes, folders, onNote, signal } = input;
      const now = input.now ?? Date.now();

      // Fail before spending anything on a listing if there's no key.
      const { provider, apiKey, model } = await resolveCredentials(providerId);

      const listing = await content.listFiles(source, signal);
      const candidates = toCandidates(source.id, listing.files);

      const { selected, counts } = selectNotes({
        candidates,
        coverage: getCoverage(),
        filters: folders?.length ? { folders } : undefined,
        limit: maxNotes,
        seed: source.id,
      });

      const questions: Question[] = [];
      const usage = { inputTokens: 0, outputTokens: 0 };
      let notesScanned = 0;

      for (const note of selected) {
        if (signal?.aborted) break;
        if (questions.length >= targetQuestions) break;

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
          const outcome = await generateFromNote({
            note: parsed,
            path: note.path,
            sourceId: source.id,
            revision: listing.revision,
            provider,
            apiKey,
            model,
            count: QUESTIONS_PER_NOTE,
            now,
            signal,
          });

          notesScanned += 1;
          questions.push(...outcome.questions);
          usage.inputTokens += outcome.usage.inputTokens;
          usage.outputTokens += outcome.usage.outputTokens;

          onNote?.({
            path: note.path,
            noteTitle: parsed.title,
            contentHash: note.contentHash,
            questions: outcome.questions,
            usage: outcome.usage,
          });
        } catch (error) {
          const appError = toAppError(error);

          /*
            An aborted request is the user pressing Cancel, not a failed note.
            Recording it as a failure would count towards the give-up threshold
            and eventually make a perfectly good note unreachable.
          */
          if (signal?.aborted) break;

          notesScanned += 1;
          onNote?.({
            path: note.path,
            noteTitle: noteStem(note.path),
            contentHash: note.contentHash,
            questions: [],
            error: appError,
          });

          /*
            Auth and quota failures will hit every remaining note identically,
            so continuing would just burn through the list producing the same
            error. Everything else is note-specific and worth moving past.
          */
          if (
            appError.code === 'llm_unauthorized' ||
            appError.code === 'llm_quota_exceeded' ||
            appError.code === 'llm_not_configured'
          ) {
            throw appError;
          }
        }
      }

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
