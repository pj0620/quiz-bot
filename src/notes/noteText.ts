import { toAppError, type AppError } from '../lib/errors';
import { getSourceType } from '../sources/registry';
import { getSourceById } from '../sources/store';

/**
 * Fetching a note's full text on demand.
 *
 * Deliberately NOT stored alongside questions. A note yields many questions, so
 * embedding its text would write the same few kilobytes into the bank once per
 * question — and the whole bank is serialised into a single key on every write.
 * Questions keep a short excerpt for the collapsed view; the full note is
 * fetched only when someone actually asks to read it.
 *
 * Reads are pinned to the revision recorded at generation time, so what is
 * shown is the text the question was actually written from rather than whatever
 * the note has since become.
 */

type CacheKey = string;

/** Session-lifetime only: notes are re-read after a restart, which is fine. */
const cache = new Map<CacheKey, string>();
/** In-flight requests, so expanding twice quickly makes one network call. */
const inFlight = new Map<CacheKey, Promise<string>>();

function keyFor(sourceId: string, path: string, revision?: string): CacheKey {
  return `${sourceId}|${path}|${revision ?? 'head'}`;
}

export type NoteRef = {
  sourceId: string;
  path: string;
  revision?: string;
};

export function getCachedNoteText(ref: NoteRef): string | undefined {
  return cache.get(keyFor(ref.sourceId, ref.path, ref.revision));
}

/**
 * Fetches a note, or throws an `AppError` describing why it couldn't.
 *
 * The source may since have been disconnected, which is a normal state rather
 * than a failure — the question outlives its source.
 */
export async function fetchNoteText(ref: NoteRef, signal?: AbortSignal): Promise<string> {
  const key = keyFor(ref.sourceId, ref.path, ref.revision);

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const source = getSourceById(ref.sourceId);
  if (!source) {
    throw toAppError(
      new Error('That source is no longer connected, so this note cannot be loaded.'),
    );
  }

  const request = getSourceType(source)
    .provider.readFile(source, ref.path, { ref: ref.revision, signal })
    .then((text) => {
      cache.set(key, text);
      return text;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function isNoteFetchError(value: unknown): value is AppError {
  return value instanceof Error;
}

/** Test seam, and used when a source is disconnected. */
export function clearNoteCache(): void {
  cache.clear();
  inFlight.clear();
}
