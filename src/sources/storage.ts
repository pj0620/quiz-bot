import { readJsonSync, writeJson } from '../lib/kv';
import type { InfoSource } from './types';
// Validation lives in its own module so adding a source type is compile-checked
// here, and so this file stays free of the API/native import chain.
import { isValidSource } from './validation';

const KEY = 'quizbot.sources.v1';
const VERSION = 1;

type Envelope = {
  version: number;
  sources: InfoSource[];
};

export function parseSources(raw: unknown): InfoSource[] {
  if (!raw || typeof raw !== 'object') return [];
  const envelope = raw as Partial<Envelope>;
  // Unknown versions are discarded, not migrated — there is nothing to migrate
  // from yet, and silently accepting a future shape would be worse.
  if (envelope.version !== VERSION) return [];
  if (!Array.isArray(envelope.sources)) return [];
  return dedupeById(envelope.sources.filter(isValidSource));
}

export function dedupeById(sources: InfoSource[]): InfoSource[] {
  const seen = new Map<string, InfoSource>();
  for (const source of sources) {
    if (!seen.has(source.id)) seen.set(source.id, source);
  }
  return Array.from(seen.values());
}

/** Synchronous so the list hydrates on first render instead of flashing empty. */
export function loadSourcesSync(): InfoSource[] {
  return parseSources(readJsonSync<Envelope>(KEY));
}

export async function saveSources(sources: InfoSource[]): Promise<void> {
  const envelope: Envelope = { version: VERSION, sources };
  await writeJson(KEY, envelope);
}

export const SOURCES_STORAGE_KEY = KEY;
