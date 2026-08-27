import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { backgroundClock } from '../../lib/appState';
import { clearPendingRun, getPendingRun, onPendingRunChange } from './pendingRun';
import { startGenerationRun } from './runStore';

/**
 * Finishes an interrupted generation run while the app is in the background.
 *
 * Worth being precise about what this is and is not, because "background task"
 * promises more than any Expo app can deliver:
 *
 *  - It does NOT keep the current request alive when the user leaves. iOS
 *    suspends the JS thread and closes sockets within seconds of backgrounding,
 *    and no managed-Expo API changes that. The in-app recovery for that path is
 *    the foreground-time timeout and retry in `lib/http.ts`.
 *  - It DOES ask the OS to wake the app later — BGTaskScheduler on iOS,
 *    WorkManager on Android — and when that happens, an unfinished run is
 *    resumed headlessly: coverage skips the notes that already finished, the
 *    remaining budget comes from `pendingRun`, and the existing completion
 *    notification fires when it ends.
 *
 * The OS owns the schedule. `minimumInterval` is a floor, not a promise; iOS in
 * particular runs these when it judges the moment cheap (often minutes to hours
 * later, reliably when charging). So the honest description is "the job will
 * finish without you reopening the app", not "the job keeps running live".
 */

export const GENERATION_RESUME_TASK = 'quizbot-generation-resume';

/**
 * The floor Android accepts. iOS treats it as guidance either way, and a run
 * the user cares about is worth asking for the earliest slot the OS allows.
 */
const MINIMUM_INTERVAL_MINUTES = 15;

/*
  Module scope on purpose, and this module is imported from the entry file
  (`index.ts`) ahead of expo-router: TaskManager requires the definition to
  exist as soon as the bundle loads, because a background launch runs the
  bundle headlessly — no screen ever mounts, and no route module (layouts
  included) is ever evaluated.
*/
TaskManager.defineTask(GENERATION_RESUME_TASK, async () => {
  const pending = getPendingRun();
  if (!pending) return BackgroundTask.BackgroundTaskResult.Success;

  const remaining = Math.max(0, pending.options.maxNotes - pending.notesDone);
  if (remaining === 0) {
    // The budget was spent before the interruption; nothing left worth paying for.
    clearPendingRun();
    return BackgroundTask.BackgroundTaskResult.Success;
  }

  /*
    The hold is what lets any of this work. Timeouts are measured in awake time
    and retries wait for the foreground (`lib/http.ts`), both of which read this
    clock — without the hold, every request started here would park itself until
    the user reopened the app, which is the exact thing this task exists to
    avoid. `isBackgrounded()` still reports true, so the completion notification
    posts as usual.
  */
  const release = backgroundClock.holdAwake();
  try {
    /*
      If the OS revived a SUSPENDED app rather than cold-launching it, the old
      run is still in flight in this JS context — `startGenerationRun` returns
      that run's promise instead of starting a new one, so both cases collapse
      into one await. Its promise never rejects; failures land in the run state
      and were already saved note by note.
    */
    await startGenerationRun({ ...pending.options, maxNotes: remaining });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    release();
  }
});

/*
  Registration mirrors the pending record: registered while a run is unfinished,
  unregistered otherwise. Leaving it always-registered would have the OS launch
  the app every few hours to discover there is nothing to do.
*/
let lastWanted: boolean | null = null;

async function syncRegistration(): Promise<void> {
  const wanted = getPendingRun() !== null;
  if (wanted === lastWanted) return;
  lastWanted = wanted;

  try {
    if (wanted) {
      await BackgroundTask.registerTaskAsync(GENERATION_RESUME_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES,
      });
    } else if (await TaskManager.isTaskRegisteredAsync(GENERATION_RESUME_TASK)) {
      await BackgroundTask.unregisterTaskAsync(GENERATION_RESUME_TASK);
    }
  } catch {
    /*
      Registration is unavailable in places the app still has to work — the iOS
      simulator, and devices with Background App Refresh turned off. The run
      itself is untouched; only the wake-up is lost. Reset so the next change
      tries again rather than trusting a state we failed to reach.
    */
    lastWanted = null;
  }
}

/**
 * Called once from the root layout. Reconciles registration with whatever the
 * last launch left behind — including a pending run from a killed app, which
 * must keep its registration so the OS can still finish it.
 */
export function initBackgroundResume(): void {
  void syncRegistration();
  onPendingRunChange(() => void syncRegistration());
}
