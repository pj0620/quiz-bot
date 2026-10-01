import { parseNoteName } from '../../notes/noteName';
import { noteStem } from '../../notes/paths';
import { coverageKey } from '../generation/coverage';
import type { NoteCandidate } from '../generation/selectNotes';
import type { PlanScope } from './types';

/**
 * Which notes a plan reads, decided by a RULE rather than a list.
 *
 * Pure and deterministic, and both properties are the point. The model
 * proposes the rule ("Thinking Fast and Slow"), but the app evaluates it — so
 * the reader sees the exact notes it matches before anything is spent, the
 * planner can be told when its rule matches nothing, and a note written next
 * week joins the plan by matching the same rule, with no model call needed to
 * decide that it belongs.
 */

/**
 * "Books/Thinking-Fast_and Slow 4.md" -> "books thinking fast and slow 4".
 *
 * Separators and case flattened on BOTH sides, so a term matches however the
 * vault happens to punctuate its filenames — hyphens, underscores, folders.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.mdx?$/i, '')
    .replace(SEPARATORS, ' ')
    .trim();
}

/*
  What counts as a word break: ASCII punctuation and whitespace, Latin-1
  symbols, general punctuation (dashes, curly quotes), CJK punctuation, and
  the fullwidth forms of ASCII punctuation (the comma in 思考，快与慢).

  Spelled out as ranges rather than `[^a-z0-9]`, which would flatten every
  non-Latin filename to nothing — a vault of Cyrillic notes could never be
  matched by a phrase. And as ranges rather than `\p{L}`, because Hermes'
  regex engine is not Node's, and a property escape that passes here could
  throw on the device.
*/
const SEPARATORS =
  /[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u2000-\u206f\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g;

/**
 * Whole words only: "art" must not pull in every note about the Smart grid,
 * and "History of America 1" must not match chapter 12.
 */
function containsTerm(haystack: string, term: string): boolean {
  const needle = normalizeForMatch(term);
  return needle.length > 0 && haystack.includes(` ${needle} `);
}

/**
 * Whether anything but hand-picked notes defines the scope. An exclude phrase
 * counts: "everything except the dailies" is a rule, and ticking one daily
 * back in must add it to that rule's notes, not replace them all.
 */
function hasRule(scope: PlanScope): boolean {
  return (
    scope.terms.length > 0 ||
    scope.excludeTerms.length > 0 ||
    scope.folders.length > 0 ||
    scope.sourceIds.length > 0
  );
}

export function matchesScope(note: NoteCandidate, scope: PlanScope): boolean {
  const key = coverageKey(note.sourceId, note.path);

  // A hand-made choice outranks every rule — in both directions.
  if (scope.exclude.includes(key)) return false;
  if (scope.include.includes(key)) return true;

  /*
    Hand-picked notes and no rule means ONLY those notes. Without this, a
    reader who cleared the phrases and ticked three notes would get the whole
    vault — no rule has always meant "every note", and the ticks would read as
    additions to everything rather than as the selection itself.
  */
  if (!hasRule(scope) && scope.include.length > 0) return false;

  if (scope.sourceIds.length > 0 && !scope.sourceIds.includes(note.sourceId)) return false;

  if (scope.folders.length > 0) {
    const folder = note.folder?.toLowerCase();
    if (!folder || !scope.folders.some((entry) => entry.toLowerCase() === folder)) return false;
  }

  const haystack = ` ${normalizeForMatch(note.path)} `;
  if (scope.excludeTerms.some((term) => containsTerm(haystack, term))) return false;
  if (scope.terms.length > 0 && !scope.terms.some((term) => containsTerm(haystack, term))) return false;

  return true;
}

/**
 * Where a note sits in its book: series first, then its number in the series.
 *
 * "Thinking Fast and Slow 4" and "Thinking Fast and Slow 12" sort as chapters,
 * not as strings — so a plan covers a book in the order it was read, and the
 * first batch is about the beginning.
 */
type BookKey = { group: string; index: number };

function bookKey(note: NoteCandidate): BookKey {
  const name = parseNoteName(noteStem(note.path));
  return { group: (name.series ?? name.title).toLowerCase(), index: name.index ?? 0 };
}

function compareKeys(a: NoteCandidate, keyA: BookKey, b: NoteCandidate, keyB: BookKey): number {
  return (
    keyA.group.localeCompare(keyB.group) ||
    keyA.index - keyB.index ||
    a.path.localeCompare(b.path) ||
    a.sourceId.localeCompare(b.sourceId)
  );
}

export function compareBookOrder(a: NoteCandidate, b: NoteCandidate): number {
  return compareKeys(a, bookKey(a), b, bookKey(b));
}

/*
  Resolved scopes, per listing. Screens resolve a plan's scope on every render
  that touches the plan — and a batch touches it several times per note — so
  without this a long run re-parses and re-sorts the whole vault per write,
  for a listing and a scope that have not changed. Keyed on the listing's
  identity, which only changes when the catalog is refreshed.
*/
const resolved = new WeakMap<readonly NoteCandidate[], Map<string, NoteCandidate[]>>();
const MAX_SCOPES_PER_LISTING = 32;

/** Every note the scope matches, in book order. */
export function resolveScope(notes: readonly NoteCandidate[], scope: PlanScope): readonly NoteCandidate[] {
  const scopeKey = JSON.stringify(scope);
  let byScope = resolved.get(notes);
  const cached = byScope?.get(scopeKey);
  if (cached) return cached;

  // Each note's place in its book is worked out once, not once per comparison.
  const keyed = notes
    .filter((note) => matchesScope(note, scope))
    .map((note) => ({ note, key: bookKey(note) }));
  keyed.sort((a, b) => compareKeys(a.note, a.key, b.note, b.key));
  const result = keyed.map((entry) => entry.note);

  if (!byScope) {
    byScope = new Map();
    resolved.set(notes, byScope);
  }
  if (byScope.size >= MAX_SCOPES_PER_LISTING) byScope.clear();
  byScope.set(scopeKey, result);
  return result;
}

/** True when nothing narrows the scope — the whole vault. */
export function isUnbounded(scope: PlanScope): boolean {
  return !hasRule(scope) && scope.include.length === 0;
}

/**
 * The scope as a phrase: "Notes matching “Thinking Fast and Slow” in Books".
 *
 * The reader never sees the scope object, so this line is their whole model of
 * which notes the plan reads — accurate and short, like `describeRule`.
 */
export function describeScope(scope: PlanScope): string {
  if (!hasRule(scope) && scope.include.length > 0) {
    const picked = `${scope.include.length} note${scope.include.length === 1 ? '' : 's'} you picked`;
    return scope.exclude.length > 0 ? `${picked} (${scope.exclude.length} left out)` : picked;
  }

  const parts: string[] = [];

  if (scope.terms.length > 0) {
    const quoted = scope.terms.map((term) => `“${term}”`);
    parts.push(`Notes matching ${quoted.length <= 2 ? quoted.join(' or ') : `${quoted.length} phrases`}`);
  } else {
    parts.push('Every note');
  }

  if (scope.folders.length > 0) {
    parts.push(`in ${scope.folders.length <= 2 ? scope.folders.join(' or ') : `${scope.folders.length} folders`}`);
  }

  if (scope.excludeTerms.length > 0) {
    parts.push(`except ${scope.excludeTerms.map((term) => `“${term}”`).join(', ')}`);
  }

  const adjustments: string[] = [];
  if (scope.include.length > 0) adjustments.push(`+${scope.include.length} by hand`);
  if (scope.exclude.length > 0) adjustments.push(`${scope.exclude.length} left out`);

  return adjustments.length > 0 ? `${parts.join(' ')} (${adjustments.join(', ')})` : parts.join(' ');
}

/** The vault filename without its extension — what a note is called on screen. */
export function noteDisplayName(path: string): string {
  return noteStem(path);
}
