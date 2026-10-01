import { parseNoteName } from '../../notes/noteName';
import { noteStem } from '../../notes/paths';
import type { NoteCandidate } from '../generation/selectNotes';
import { compareBookOrder } from './scope';

/**
 * What the planner is told about the reader's notes, and what the start screen
 * offers to plan around.
 *
 * Grouped by SERIES — the numbered runs `parseNoteName` already finds — rather
 * than listed file by file. A vault of 400 notes is mostly a few books and
 * podcasts in many parts, and "Thinking Fast and Slow — 38 notes" tells the
 * planner everything it needs to pick a scope in one line, where 38 filenames
 * would spend a few thousand tokens on every turn of the conversation saying
 * the same thing.
 */

export type SeriesGroup = {
  name: string;
  count: number;
  folders: string[];
  /** One real filename, so the planner sees how the series is spelled. */
  example: string;
  firstIndex?: number;
  lastIndex?: number;
};

/** A run of one is not a series: it is listed with the loose notes instead. */
const MIN_SERIES_SIZE = 2;

export function groupBySeries(notes: readonly NoteCandidate[]): {
  series: SeriesGroup[];
  loose: NoteCandidate[];
} {
  const groups = new Map<string, NoteCandidate[]>();
  const loose: NoteCandidate[] = [];

  for (const note of notes) {
    const series = parseNoteName(noteStem(note.path)).series;
    if (!series) {
      loose.push(note);
      continue;
    }
    const key = series.toLowerCase();
    const members = groups.get(key);
    if (members) members.push(note);
    else groups.set(key, [note]);
  }

  const series: SeriesGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < MIN_SERIES_SIZE) {
      loose.push(...members);
      continue;
    }
    const ordered = [...members].sort(compareBookOrder);
    const indexes = ordered
      .map((note) => parseNoteName(noteStem(note.path)).index)
      .filter((index): index is number => index !== undefined);
    series.push({
      name: parseNoteName(noteStem(ordered[0].path)).series ?? '',
      count: members.length,
      folders: Array.from(new Set(members.map((note) => note.folder ?? '(vault root)'))).sort(),
      example: noteStem(ordered[0].path),
      ...(indexes.length > 0 ? { firstIndex: Math.min(...indexes), lastIndex: Math.max(...indexes) } : {}),
    });
  }

  series.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  loose.sort(compareBookOrder);
  return { series, loose };
}

function folderCounts(notes: readonly NoteCandidate[]): string {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const folder = note.folder ?? '(vault root)';
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return Array.from(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([folder, count]) => `${folder} (${count})`)
    .join(', ');
}

/** Loose notes listed by path; beyond this they are counted, not named. */
const MAX_LOOSE_LISTED = 120;

/**
 * The catalogue the planner reads, as plain lines.
 *
 * Paths are shown without their extension and with their folder, because the
 * planner's scope terms are matched against exactly that — showing it the
 * string it is matching against is what lets it pick terms that work.
 */
export function describeCatalog(notes: readonly NoteCandidate[], maxLoose = MAX_LOOSE_LISTED): string {
  if (notes.length === 0) return 'No notes could be listed right now.';

  const { series, loose } = groupBySeries(notes);
  const lines = [`${notes.length} note${notes.length === 1 ? '' : 's'} in total.`, `Folders: ${folderCounts(notes)}`];

  if (series.length > 0) {
    lines.push('', 'Series (filenames sharing a name and a running number):');
    for (const group of series) {
      const range =
        group.firstIndex !== undefined && group.lastIndex !== undefined && group.firstIndex !== group.lastIndex
          ? `, numbered ${group.firstIndex}–${group.lastIndex}`
          : '';
      lines.push(
        `- "${group.name}" — ${group.count} notes${range}, in ${group.folders.join(', ')}. e.g. "${group.example}"`,
      );
    }
  }

  if (loose.length > 0) {
    lines.push('', series.length > 0 ? 'Other notes:' : 'Notes:');
    for (const note of loose.slice(0, maxLoose)) {
      lines.push(`- ${note.path.replace(/\.mdx?$/i, '')}`);
    }
    if (loose.length > maxLoose) lines.push(`…and ${loose.length - maxLoose} more not listed.`);
  }

  return lines.join('\n');
}

export type PlanSuggestion = {
  /** The chip: "Thinking Fast and Slow · 38". */
  label: string;
  /** What tapping it puts in the request box. */
  request: string;
};

/**
 * Starting points for the request box, from what the vault actually holds —
 * so the first thing on the screen is the reader's own books, not an example
 * they have to translate into their own material.
 */
export function suggestRequests(notes: readonly NoteCandidate[], max = 4): PlanSuggestion[] {
  const { series } = groupBySeries(notes);
  const suggestions: PlanSuggestion[] = series.slice(0, max).map((group) => ({
    label: `${group.name} · ${group.count}`,
    request: `Quiz me on my ${group.name} notes — the big ideas, not the trivia.`,
  }));

  if (suggestions.length < max) {
    const counts = new Map<string, number>();
    for (const note of notes) {
      if (note.folder) counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1);
    }
    const folders = Array.from(counts)
      .filter(([, count]) => count >= MIN_SERIES_SIZE)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [folder, count] of folders) {
      if (suggestions.length >= max) break;
      suggestions.push({
        label: `${folder} folder · ${count}`,
        request: `Quiz me on everything in my ${folder} folder.`,
      });
    }
  }

  return suggestions;
}
