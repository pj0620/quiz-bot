import { createStore } from '../../lib/createStore';
import { toAppError, userMessage } from '../../lib/errors';
import { forEachInPool } from '../../lib/pool';
import { resolveCredentialsOrNull } from '../../features/llm/credentials';
import { generateVocabQuestions } from '../../features/llm/generateVocabQuestions';
import { getConcurrency, getGuidance } from '../../features/llm/settings';
import type { NoteStatus, RunNote, RunStatus } from '../generation/runStore';
import { addQuestions } from '../store';
import {
  getVocabWord,
  questionsForWord,
  recordFailure,
  recordGenerated,
  updateWordSense,
} from './store';

/**
 * A batch of words being turned into questions.
 *
 * A SECOND run store rather than a reuse of `generation/runStore`, and the
 * first reason is a real bug rather than a preference: `startGenerationRun`
 * opens with `if (inFlight) return inFlight`, so sharing it would make a vocab
 * batch started during a vault run silently return the vault run's promise and
 * do nothing at all — no cost, no questions, no error to explain it. Two kinds
 * of run need two locks.
 *
 * Beyond that, the note run store drives the Library status card and the tab
 * badge, both worded in notes ("Looking at your notes…"), and generalising
 * `pollAllSources` would mean parameterising the work function, the plan shape,
 * the coverage writes and the finish notification — a large change to the most
 * delicate concurrency code in the app, for a job that is a handful of short
 * requests.
 *
 * A store rather than screen state because three screens render the same
 * progress: the word list, a word's own page, and the suggestion screen, which
 * starts a batch and then navigates away from itself.
 *
 * Rows are `RunNote`s so `ui/components/RunNoteRow` renders them unchanged.
 */

export type VocabRunState = {
  status: RunStatus;
  words: RunNote[];
  /** Questions saved to the bank across the batch. */
  added: number;
  usage: { inputTokens: number; outputTokens: number };
  /** The failure that ended the batch, when one did. Kept raw for `ErrorBanner`. */
  error?: unknown;
  startedAt?: number;
  finishedAt?: number;
};

/** How many questions one word is worth, as a ceiling. */
const QUESTIONS_PER_WORD = 5;

const IDLE: VocabRunState = {
  status: 'idle',
  words: [],
  added: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
};

export const vocabRunStore = createStore<VocabRunState>(IDLE);

/*
  Held outside the store: neither is state a screen should render, and putting a
  live controller in an immutable snapshot invites someone to copy it.
*/
let controller: AbortController | null = null;
let inFlight: Promise<void> | null = null;

export function isVocabRunActive(): boolean {
  return vocabRunStore.get().status === 'running';
}

function patchWord(slug: string, patch: Partial<RunNote>): void {
  vocabRunStore.set((state) => {
    const index = state.words.findIndex((word) => word.key === slug);
    if (index === -1) return state;
    const words = [...state.words];
    words[index] = { ...words[index], ...patch };
    return { ...state, words };
  });
}

/** Anything still waiting when the batch ends never ran. Say so rather than leaving a spinner. */
function settleOutstanding(): void {
  vocabRunStore.set((state) => ({
    ...state,
    words: state.words.map((word) =>
      word.status === 'pending' || word.status === 'running'
        ? { ...word, status: 'skipped' as NoteStatus }
        : word,
    ),
  }));
}

/**
 * Writes questions for each word, saving as it goes.
 *
 * Per word, not at the end — the discipline the note poller already follows.
 * A batch that is cancelled, or that dies on word seven, keeps everything the
 * first six were paid for.
 */
export function startVocabRun(slugs: readonly string[]): Promise<void> {
  if (inFlight) return inFlight;
  if (slugs.length === 0) return Promise.resolve();

  controller = new AbortController();
  const signal = controller.signal;

  vocabRunStore.set({
    status: 'running',
    words: slugs.map((slug) => ({
      key: slug,
      title: getVocabWord(slug)?.word ?? slug,
      status: 'pending',
      questionCount: 0,
    })),
    added: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    startedAt: Date.now(),
  });

  inFlight = (async () => {
    /*
      Credentials once, up front, so a batch with no key fails before it starts
      rather than once per word. Not a throw: the words are already saved and
      still worth keeping, so this settles as a finished run with every word
      skipped and a reason recorded against each.
    */
    const credentials = await resolveCredentialsOrNull('generate');
    if (!credentials) {
      for (const slug of slugs) {
        recordFailure(slug, 'No model configured.');
        patchWord(slug, { status: 'skipped', error: 'No model configured' });
      }
      return;
    }

    // Read once per batch, not per word: the reader could open Settings and
    // edit it mid-run, and half a batch obeying new instructions is worse than
    // all of it obeying the old ones.
    const guidance = getGuidance();

    await forEachInPool(
      slugs,
      getConcurrency(),
      async (slug) => {
        const word = getVocabWord(slug);
        if (!word) {
          patchWord(slug, { status: 'skipped' });
          return;
        }

        patchWord(slug, { status: 'running' });

        try {
          const result = await generateVocabQuestions({
            word: word.word,
            slug: word.slug,
            ...(word.definition ? { definition: word.definition } : {}),
            count: QUESTIONS_PER_WORD,
            alreadyAsked: questionsForWord(slug).map((question) => question.prompt),
            provider: credentials.provider,
            apiKey: credentials.apiKey,
            model: credentials.model,
            ...(guidance ? { guidance } : {}),
            signal,
          });

          vocabRunStore.set((state) => ({
            ...state,
            usage: {
              inputTokens: state.usage.inputTokens + result.usage.inputTokens,
              outputTokens: state.usage.outputTokens + result.usage.outputTokens,
            },
          }));

          if (result.unknown) {
            recordFailure(slug, "That doesn't look like a word the model recognises.");
            patchWord(slug, { status: 'failed', error: 'Not a word it recognises' });
            return;
          }

          updateWordSense(slug, {
            ...(result.definition ? { definition: result.definition } : {}),
            ...(result.partOfSpeech ? { partOfSpeech: result.partOfSpeech } : {}),
          });

          const { added } = addQuestions(result.questions);
          recordGenerated(slug);

          vocabRunStore.set((state) => ({ ...state, added: state.added + added }));
          patchWord(slug, { status: 'done', questionCount: result.questions.length });
        } catch (error) {
          // Cancelling is not a failure of the word, and recording it as one
          // would leave a red row against a word nobody ever tried.
          if (signal.aborted) return;

          const appError = toAppError(error);
          recordFailure(slug, userMessage(appError));
          patchWord(slug, { status: 'failed', error: userMessage(appError) });

          /*
            Auth and quota failures will hit every remaining word identically,
            so continuing just pays for the same rejection ten more times.
            Thrown so the pool re-throws it to the caller and it reaches the
            screen as an error rather than as a batch that quietly ended early.
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
      { stop: () => signal.aborted },
    );
  })()
    .then(() => {
      settleOutstanding();
      vocabRunStore.set((state) => ({
        ...state,
        status: signal.aborted ? 'cancelled' : 'finished',
        finishedAt: Date.now(),
      }));
    })
    .catch((error: unknown) => {
      settleOutstanding();
      vocabRunStore.set((state) => ({
        ...state,
        status: signal.aborted ? 'cancelled' : 'finished',
        error,
        finishedAt: Date.now(),
      }));
    })
    .finally(() => {
      inFlight = null;
      controller = null;
    });

  return inFlight;
}

export function cancelVocabRun(): void {
  controller?.abort();
}

/** Clears a settled batch, so the panel goes away when the reader is done with it. */
export function resetVocabRun(): void {
  if (isVocabRunActive()) return;
  vocabRunStore.set(IDLE);
}
