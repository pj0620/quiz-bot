import { createStore } from '../../lib/createStore';
import { coverageKey } from './coverage';
import { clearPendingRun, recordPendingNote, savePendingRun } from './pendingRun';
import { pollAllSources } from './poller';
import { notifyRunFinished } from './runNotification';
import type { PlannedNote } from './contract';

/**
 * The state of the generation run currently happening, if any.
 *
 * A module-level store rather than screen state, and that is the entire point.
 * A run costs real money and takes minutes; holding it in a component meant it
 * belonged to whichever screen happened to be mounted, so navigating away threw
 * the progress display on the floor while the requests carried on invisibly in
 * the background — and coming back showed nothing at all.
 *
 * Here the run outlives every screen. `app/generate.tsx` is a view of this, not
 * the owner of it, and can be left and returned to freely.
 *
 * What this does NOT do is keep working while the app is suspended. iOS stops
 * the JS thread within seconds of the app being backgrounded, and no library
 * available to an Expo app changes that for arbitrary work. What it does do is
 * survive the interruption, which takes three things — see `lib/http.ts` for
 * the first two:
 *
 *  - Requests aren't billed for the time the app spent asleep, so returning
 *    doesn't expire every one of them at once.
 *  - The sockets iOS closed on the way out are retried once the app is awake,
 *    because a suspended app's requests are cut off rather than answered.
 *  - Completed notes are already saved and their coverage already recorded, so
 *    whatever did finish is kept and isn't paid for twice.
 *
 * On top of surviving the interruption, an interrupted run is also FINISHED
 * without the user returning: `pendingRun` persists the intent and
 * `backgroundResume` asks the OS to wake the app and resume it. That wake-up
 * happens on the OS's schedule, not in real time — see `backgroundResume.ts`.
 */

export type NoteStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type RunNote = {
  /** `sourceId:path` — unique across sources, and stable across a resume. */
  key: string;
  /** The vault filename, verbatim. */
  title: string;
  status: NoteStatus;
  /** Questions this note produced. Meaningful once `status` is 'done'. */
  questionCount: number;
  error?: string;
};

export type RunStatus = 'idle' | 'running' | 'finished' | 'cancelled';

export type RunState = {
  status: RunStatus;
  notes: RunNote[];
  /** Questions saved to the bank across the run. */
  added: number;
  usage: { inputTokens: number; outputTokens: number };
  /** The failure that ended the run, when one did. Kept raw for `ErrorBanner`. */
  error?: unknown;
  startedAt?: number;
  finishedAt?: number;
};

export type StartRunOptions = {
  maxNotes: number;
  folders?: string[];
  concurrency?: number;
};

const IDLE: RunState = {
  status: 'idle',
  notes: [],
  added: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
};

export const runStore = createStore<RunState>(IDLE);

/*
  Held outside the store because neither is state a screen should render, and
  putting a live controller in an immutable snapshot invites someone to copy it.
*/
let controller: AbortController | null = null;
let inFlight: Promise<void> | null = null;

export function isRunActive(): boolean {
  return runStore.get().status === 'running';
}

function patchNote(key: string, patch: Partial<RunNote>): void {
  runStore.set((state) => {
    const index = state.notes.findIndex((note) => note.key === key);
    if (index === -1) return state;
    const notes = [...state.notes];
    notes[index] = { ...notes[index], ...patch };
    return { ...state, notes };
  });
}

function addPlannedNotes(planned: readonly PlannedNote[]): void {
  runStore.set((state) => {
    const known = new Set(state.notes.map((note) => note.key));
    const additions: RunNote[] = [];

    for (const note of planned) {
      const key = coverageKey(note.sourceId, note.path);
      // Sources are polled one after another, so a second source appends to the
      // list rather than replacing it.
      if (known.has(key)) continue;
      known.add(key);
      additions.push({ key, title: note.noteTitle, status: 'pending', questionCount: 0 });
    }

    return additions.length === 0 ? state : { ...state, notes: [...state.notes, ...additions] };
  });
}

/**
 * Settles whatever never got a result.
 *
 * A run can end with notes still pending: the user cancelled, a question target
 * was reached, or a fatal error stopped it. Leaving those rows saying "waiting"
 * would be a lie that never resolves.
 */
function settleOutstanding(): void {
  runStore.set((state) => {
    if (!state.notes.some((note) => note.status === 'pending' || note.status === 'running')) {
      return state;
    }
    return {
      ...state,
      notes: state.notes.map((note) =>
        note.status === 'pending' || note.status === 'running'
          ? { ...note, status: 'skipped' as const }
          : note,
      ),
    };
  });
}

/**
 * Starts a run, or does nothing if one is already going.
 *
 * Returns the run's promise so a caller can await it, but nothing has to: the
 * store is the interface, and the run completes whether or not anyone is
 * listening.
 */
export function startGenerationRun(options: StartRunOptions): Promise<void> {
  if (inFlight) return inFlight;

  controller = new AbortController();
  const signal = controller.signal;

  runStore.set({
    status: 'running',
    notes: [],
    added: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    startedAt: Date.now(),
  });

  // Persisted so a run the OS kills mid-flight can be finished from a
  // background task launch. Cleared below whenever the run ends in this
  // process — surviving the record therefore MEANS the run was interrupted.
  savePendingRun(options);

  inFlight = pollAllSources({
    maxNotes: options.maxNotes,
    folders: options.folders,
    concurrency: options.concurrency,
    signal,
    onPlan: addPlannedNotes,
    onNoteStart: (note) => patchNote(coverageKey(note.sourceId, note.path), { status: 'running' }),
    onProgress: ({ sourceId, event, addedSoFar }) => {
      // Success or failure alike: both spend budget, and a background resume
      // must not re-spend it. Matches the poller's own notesDone accounting.
      recordPendingNote();
      patchNote(coverageKey(sourceId, event.path), {
        status: event.error ? 'failed' : 'done',
        questionCount: event.questions.length,
        error: event.error?.message,
      });
      /*
        Totalled note by note rather than taken from the result at the end.

        Tokens are what a run costs, and a run that ends badly is exactly the
        one whose cost the user most wants to see — waiting for a clean return
        value would report zero for it.
      */
      runStore.set((state) => ({
        ...state,
        added: addedSoFar,
        usage: {
          inputTokens: state.usage.inputTokens + (event.usage?.inputTokens ?? 0),
          outputTokens: state.usage.outputTokens + (event.usage?.outputTokens ?? 0),
        },
      }));
    },
  })
    .then((result) => {
      settleOutstanding();
      /*
        `usage` is deliberately NOT taken from the result.

        `pollAllSources` catches a source that failed and returns without its
        totals, so the returned figure is zero for exactly the run that spent
        money and then broke. The running sum above counts every note event as
        it lands, including the ones on the way to the failure.
      */
      runStore.set((state) => ({
        ...state,
        // Cancelling is a choice, not a failure, and the two read very
        // differently at the end of a run that cost money.
        status: signal.aborted ? 'cancelled' : 'finished',
        error: result.errors.length > 0 ? new Error(result.errors[0].message) : undefined,
        finishedAt: Date.now(),
      }));
    })
    .catch((error: unknown) => {
      settleOutstanding();
      runStore.set((state) => ({
        ...state,
        status: signal.aborted ? 'cancelled' : 'finished',
        error,
        finishedAt: Date.now(),
      }));
    })
    .finally(() => {
      inFlight = null;
      controller = null;
      // The run ended in THIS process — finished, failed or cancelled — so
      // there is nothing left for a background launch to resume.
      clearPendingRun();
      // After the state is settled, so the notification describes the run the
      // user will find when they open the app. Never awaited — a run does not
      // wait on a courtesy.
      void notifyRunFinished(runStore.get());
    });

  return inFlight;
}

/** Notes already finished stay saved — see `poller`, which writes per note. */
export function cancelGenerationRun(): void {
  controller?.abort();
}

/** Clears a finished run so the screen goes back to its setup state. */
export function resetGenerationRun(): void {
  if (isRunActive()) return;
  runStore.set(IDLE);
}
