import { backgroundClock } from '../../lib/appState';
import { bankStore, reviewStore } from '../store';
import { isSyncRunning, runSync } from './run';
import { getSyncSettings, syncSettingsStore } from './settings';

/**
 * Syncs on its own, a little after the bank or a review changes.
 *
 * Debounced rather than per change: a session answers ten questions in a
 * row, and ten commits for that would be noise in the vault's history. Only
 * in the foreground — iOS closes sockets on suspend, and a sync that starts
 * as the app leaves would fail every time (see `lib/appState.ts`); one that
 * is wanted while backgrounded simply waits for the app to come back.
 */

const DEBOUNCE_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let initialised = false;

function wanted(): boolean {
  const settings = getSyncSettings();
  return settings.auto && !!settings.sourceId;
}

async function fire(): Promise<void> {
  timer = null;
  if (!wanted()) return;
  if (backgroundClock.isBackgrounded()) await backgroundClock.whenForeground();
  if (isSyncRunning()) {
    // Changes made during a sync are not in that commit; go again after it.
    schedule();
    return;
  }
  await runSync();
}

function schedule(): void {
  if (!wanted()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void fire(), DEBOUNCE_MS);
}

/** Called once from the root layout. Also runs one catch-up sync after launch. */
export function initSyncTriggers(): void {
  if (initialised) return;
  initialised = true;
  bankStore.subscribe(schedule);
  reviewStore.subscribe(schedule);
  syncSettingsStore.subscribe(schedule);
  schedule();
}
