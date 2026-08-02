import { hashString, seededShuffle } from '../../lib/random';
import { isNotePath, noteStem } from '../../notes/paths';
import type { SourceFileEntry } from '../../sources/types';
import { coverageKey, MAX_FAILURES, type NoteCoverage } from './coverage';

/**
 * Which notes are worth spending a generation call on.
 *
 * Pure, so the rule that decides where money goes is testable without a network,
 * a provider, or a store.
 *
 * The ordering is a priority, not a preference:
 *
 *   1. never generated from  — new material, what someone actually wants
 *   2. edited since last run — the note says something different now
 *   3. everything else       — SKIPPED, not merely deprioritised
 *
 * Step 3 is the important one. Because edits keep old questions rather than
 * replacing them, and because a model rewords questions on every run, a note
 * re-read at an unchanged version produces near-duplicates that nothing
 * downstream catches. Skipping is what makes a second run cheap and safe.
 */

export type NoteCandidate = {
  sourceId: string;
  path: string;
  contentHash?: string;
  /** Display name, parsed from the filename. */
  title: string;
  /** Top-level directory, for the folder filter. */
  folder?: string;
};

export type SelectionReason = 'new' | 'changed';

export type SelectedNote = NoteCandidate & { reason: SelectionReason };

export type SelectionFilters = {
  /** Restrict to these top-level folders. Empty/absent = everywhere. */
  folders?: string[];
};

export type SelectionSummary = {
  selected: SelectedNote[];
  counts: {
    total: number;
    new: number;
    changed: number;
    /** Already covered at this exact version. */
    covered: number;
    /** Failed too many times to keep trying. */
    skipped: number;
    /** Excluded by the folder filter. */
    filtered: number;
  };
};

/** The top-level directory of a path, or undefined at the vault root. */
export function folderOf(path: string): string | undefined {
  const segments = path.split('/').filter(Boolean);
  return segments.length > 1 ? segments[0] : undefined;
}

/** Turns a provider listing into selection candidates, keeping only notes. */
export function toCandidates(
  sourceId: string,
  files: readonly SourceFileEntry[],
): NoteCandidate[] {
  return files
    .filter((file) => isNotePath(file.path))
    .map((file) => ({
      sourceId,
      path: file.path,
      contentHash: file.contentHash,
      title: noteStem(file.path),
      folder: folderOf(file.path),
    }));
}

/** Every folder that actually contains notes, for the filter chips. */
export function foldersOf(candidates: readonly NoteCandidate[]): string[] {
  const folders = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.folder) folders.add(candidate.folder);
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

function classify(
  candidate: NoteCandidate,
  coverage: NoteCoverage | undefined,
): SelectionReason | 'covered' | 'skipped' {
  if (!coverage || coverage.generatedAt === 0) {
    // Never successfully generated from. A prior failure leaves an entry with
    // generatedAt 0, which still counts as new until it exhausts its retries.
    if ((coverage?.failures ?? 0) >= MAX_FAILURES) return 'skipped';
    return 'new';
  }

  if ((coverage.failures ?? 0) >= MAX_FAILURES) return 'skipped';

  /*
    No hash on either side means the provider can't tell us whether the note
    changed. Treating that as "covered" is the safe reading: re-running would
    duplicate on every pass forever, and the user can still force a re-read by
    clearing coverage.
  */
  if (!candidate.contentHash || !coverage.contentHash) return 'covered';

  return candidate.contentHash === coverage.contentHash ? 'covered' : 'changed';
}

export function selectNotes(input: {
  candidates: readonly NoteCandidate[];
  coverage: Readonly<Record<string, NoteCoverage>>;
  filters?: SelectionFilters;
  /** Upper bound on how many notes to hand back. */
  limit: number;
  /** Stable ordering within a tier. */
  seed?: string;
}): SelectionSummary {
  const { candidates, coverage, filters, limit } = input;

  const counts = { total: candidates.length, new: 0, changed: 0, covered: 0, skipped: 0, filtered: 0 };
  const fresh: SelectedNote[] = [];
  const changed: SelectedNote[] = [];

  for (const candidate of candidates) {
    if (filters?.folders?.length) {
      if (!candidate.folder || !filters.folders.includes(candidate.folder)) {
        counts.filtered += 1;
        continue;
      }
    }

    const entry = coverage[coverageKey(candidate.sourceId, candidate.path)];
    const reason = classify(candidate, entry);

    if (reason === 'covered') counts.covered += 1;
    else if (reason === 'skipped') counts.skipped += 1;
    else if (reason === 'new') {
      counts.new += 1;
      fresh.push({ ...candidate, reason });
    } else {
      counts.changed += 1;
      changed.push({ ...candidate, reason });
    }
  }

  // Shuffled rather than left in tree order so a vault isn't always covered
  // alphabetically; seeded so a cancelled run resumes predictably instead of
  // reshuffling under the user.
  const seed = hashString(input.seed ?? 'quizbot');
  const ordered = [...seededShuffle(fresh, seed), ...seededShuffle(changed, seed)];

  return { selected: ordered.slice(0, Math.max(0, limit)), counts };
}
