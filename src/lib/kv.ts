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

export function getItemSync(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
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
