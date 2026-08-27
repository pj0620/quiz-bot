import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { backgroundClock } from '../../lib/appState';
import type { RunState } from './runStore';

/**
 * Tells the user a generation run has finished when they aren't looking at it.
 *
 * Deliberately ONE notification at the end rather than a progress notification
 * that ticks along, and it is worth being clear about why, because a live
 * progress notification is the obvious thing to want:
 *
 *  - On iOS the JS thread stops within seconds of the app being backgrounded.
 *    Nothing is running to update a notification with, and no library available
 *    to a managed Expo app changes that. A genuinely live progress indicator
 *    needs a Live Activity, which is a native widget extension — a custom
 *    development build, not Expo Go.
 *  - Android could do it with a foreground service, which is also native code
 *    and a custom build.
 *  - And re-posting a notification per note produces a banner per note. Ten
 *    notes is ten interruptions to say something the screen already shows.
 *
 * So: one notification, only when the run ends, and only when the app isn't in
 * front of the user — where it is the difference between "start a run and go do
 * something else" and "sit and watch a progress bar".
 */

const ANDROID_CHANNEL = 'generation';

let configured = false;
/** Permission is requested once per launch at most, and never speculatively. */
let permission: Promise<boolean> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // A banner while the app is open would be redundant — the screen shows the
    // same thing, better. `notifyRunFinished` decides whether to post at all.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function ensureConfigured(): Promise<boolean> {
  if (!configured) {
    configured = true;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: 'Question generation',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  }

  /*
    Asked for at the end of the first run, not at launch.

    A permission prompt on a screen the user has not asked anything of is the
    one guaranteed way to get it denied — and by this point they have started a
    run that takes minutes, which is the moment being notified is worth
    something.
  */
  permission ??= (async () => {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  })();

  return permission;
}

function summarise(run: RunState): { title: string; body: string } | null {
  const failed = run.notes.filter((note) => note.status === 'failed').length;
  const done = run.notes.filter((note) => note.status === 'done').length;

  if (run.status === 'cancelled') {
    // Cancelling is a deliberate act with an immediate on-screen result. Being
    // told about it afterwards is noise.
    return null;
  }

  const questions = `${run.added} question${run.added === 1 ? '' : 's'}`;
  const notes = `${done} note${done === 1 ? '' : 's'}`;

  return {
    title: run.error ? 'Generation stopped' : 'Questions ready',
    body: run.error
      ? `${questions} from ${notes} before it stopped. Open QuizBot to see why.`
      : `${questions} from ${notes}${failed > 0 ? `, ${failed} failed` : ''}.`,
  };
}

/**
 * Posts the completion notification, unless the app is in front of the user.
 *
 * Every failure is swallowed. Notifications are a courtesy on top of a run that
 * has already succeeded and already saved its questions; a denied permission or
 * an unavailable module must not surface as an error about generation.
 */
export async function notifyRunFinished(run: RunState): Promise<void> {
  // The same clock the request timeouts read, rather than a second subscription
  // to AppState — one answer to "is the app in front of the user" is enough.
  if (!backgroundClock.isBackgrounded()) return;

  const summary = summarise(run);
  if (!summary) return;

  try {
    if (!(await ensureConfigured())) return;
    await Notifications.scheduleNotificationAsync({
      content: { ...summary, ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : null) },
      trigger: null,
    });
  } catch {
    // Nothing to do and nothing worth saying: the run itself was fine.
  }
}
