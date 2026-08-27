import Storage from 'expo-sqlite/kv-store';

import { AppError } from './errors';

/**
 * Non-secret persistence (source list, connection metadata).
 *
 * expo-sqlite/kv-store is API-compatible with AsyncStorage but ships with Expo,
 * so it avoids a third-party dependency, and it exposes synchronous reads which
 * let stores hydrate on first render instead of flashing an empty list.
 *
 * Secrets never come through here — those go to secureTokenStore.ts.
 */

/**
 * Set when a synchronous read THREW, which is a different thing from "no value
 * stored" — and the difference is the whole reason this flag exists.
 *
 * Stores hydrate synchronously at import time and then persist their in-memory
 * state on the next mutation. If a read fails and is reported as "empty", the
 * store comes up blank and the first write flattens whatever was really there.
 * That is silent, total, and unrecoverable data loss from a transient failure.
 *
 * So a failed read makes storage DEGRADED, and writes are refused until a read
 * succeeds again. Losing a write is recoverable; overwriting a question bank
 * with an empty array is not.
 */
let degraded = false;

export function isStorageDegraded(): boolean {
  return degraded;
}

export function getItemSync(key: string): string | null {
  try {
    const value = Storage.getItemSync(key);
    // A read that returns null is a legitimate "nothing stored" — only a THROW
    // means we don't know what's there, so success always clears the flag.
    degraded = false;
    return value;
  } catch {
    degraded = true;
    return null;
  }
}

export async function getItem(key: string): Promise<string | null> {
  try {
    return await Storage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  /*
    Refusing the write is the point. Every store in the app persists its whole
    in-memory state, so writing while hydration is known to have failed replaces
    real data with whatever the empty store happens to hold.
  */
  if (degraded) {
    if (__DEV__) {
      console.warn(
        `[kv] refusing to write "${key}": a synchronous read failed earlier, so the ` +
          'in-memory state may be empty and writing it would destroy stored data.',
      );
    }
    throw new AppError('storage', {
      message: 'Storage could not be read, so nothing is being saved until it recovers.',
    });
  }

  try {
    await Storage.setItem(key, value);
  } catch (error) {
    throw new AppError('storage', { cause: error });
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await Storage.removeItem(key);
  } catch (error) {
    throw new AppError('storage', { cause: error });
  }
}

/** Reads and parses JSON, returning null on absent or malformed values. */
export function readJsonSync<T>(key: string): T | null {
  const raw = getItemSync(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await setItem(key, JSON.stringify(value));
}
