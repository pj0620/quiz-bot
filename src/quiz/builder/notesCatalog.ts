import { createStore } from '../../lib/createStore';
import { getSourceType } from '../../sources/registry';
import { getSources } from '../../sources/store';
import { toCandidates, type NoteCandidate } from '../generation/selectNotes';

/**
 * Every note across every connected source, listed once and shared.
 *
 * The planner, the plan screens, a batch and the new-note check all need the
 * same listing, and each listing is a tree request per source. Without a
 * shared copy, opening a plan, chatting about it and starting a batch would
 * list the vault three times in a minute — so this caches for a short while,
 * and joins concurrent callers onto one request.
 */

export type CatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  notes: NoteCandidate[];
  /** The revision each source was listed at, for pinning reads — see `readFile`. */
  revisions: Record<string, string | undefined>;
  /**
   * Every source answered, in full. A partial listing is fine to SHOW, but
   * never to baseline or detect new notes against: notes from a source that
   * failed — or past the cutoff of a truncated tree — would look absent now
   * and "new" the next time they are listed, and be written up unprompted.
   */
  complete: boolean;
  /** A source's tree was too big for GitHub to return whole. */
  truncated: boolean;
  fetchedAt?: number;
  /** The first source failure, kept raw for `ErrorBanner`. */
  error?: unknown;
};

const IDLE: CatalogState = { status: 'idle', notes: [], revisions: {}, complete: false, truncated: false };

export const catalogStore = createStore<CatalogState>(IDLE);

/** Long enough to cover one sitting with a plan; short enough that a new note shows up. */
export const CATALOG_MAX_AGE_MS = 2 * 60_000;

let inFlight: Promise<CatalogState> | null = null;

export function getCatalog(): CatalogState {
  return catalogStore.get();
}

/**
 * The catalog, re-listed when older than `maxAgeMs` (pass 0 to force it).
 *
 * Never rejects: a failure lands in the state, alongside whatever an earlier
 * listing found, so a screen keeps showing notes through a dropped connection.
 */
export function refreshCatalog(options: { maxAgeMs?: number } = {}): Promise<CatalogState> {
  const current = catalogStore.get();
  const maxAge = options.maxAgeMs ?? CATALOG_MAX_AGE_MS;
  if (
    current.status === 'ready' &&
    current.fetchedAt !== undefined &&
    Date.now() - current.fetchedAt < maxAge
  ) {
    return Promise.resolve(current);
  }
  if (inFlight) return inFlight;

  catalogStore.set({ ...current, status: 'loading', error: undefined });

  inFlight = (async () => {
    const sources = getSources();
    const notes: NoteCandidate[] = [];
    const revisions: Record<string, string | undefined> = {};
    let truncated = false;
    let firstError: unknown;
    let failures = 0;

    for (const source of sources) {
      try {
        const listing = await getSourceType(source).provider.listFiles(source);
        notes.push(...toCandidates(source.id, listing.files));
        revisions[source.id] = listing.revision;
        truncated = truncated || listing.truncated;
      } catch (error) {
        failures += 1;
        if (firstError === undefined) firstError = error;
      }
    }

    const previous = catalogStore.get();
    const next: CatalogState =
      failures > 0 && failures === sources.length
        ? // Nothing answered: keep the last good listing on screen, flagged.
          { ...previous, status: 'error', error: firstError, complete: false }
        : {
            status: 'ready',
            notes,
            revisions,
            complete: failures === 0 && !truncated,
            truncated,
            fetchedAt: Date.now(),
            ...(firstError !== undefined ? { error: firstError } : {}),
          };
    catalogStore.set(next);
    return next;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Test seam, and what a disconnected source should trigger. */
export function resetCatalog(): void {
  catalogStore.set(IDLE);
}
