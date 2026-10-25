import { readJsonSync, removeItem, writeJson } from '../../lib/kv';
import { isValidLedger, type SyncLedger } from './diff';

/**
 * Where the sync ledger lives. One kv value, written only by the sync runner
 * after a commit lands — there is no second writer to race with.
 */
export const LEDGER_KEY = 'quizbot.sync.ledger.v1';

export function loadLedger(): SyncLedger | null {
  const stored = readJsonSync<unknown>(LEDGER_KEY);
  return isValidLedger(stored) ? stored : null;
}

export async function saveLedger(ledger: SyncLedger): Promise<void> {
  await writeJson(LEDGER_KEY, ledger);
}

/** Forgets what was written. The files stay in the vault; the next sync treats them as foreign. */
export async function clearLedger(): Promise<void> {
  await removeItem(LEDGER_KEY);
}
