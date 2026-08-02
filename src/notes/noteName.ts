/**
 * Note filenames carry structure, and reading it is what makes topics useful.
 *
 * A vault names notes like "History of America 40 First Year of Fighting":
 * a SERIES, an INDEX, and a TITLE. Treating that whole string as one topic —
 * which is what deriving topics from file paths does — gives every note its own
 * near-unique topic, so topic quizzes match one note each and mastery is
 * computed over samples of size one. Both features quietly become useless.
 *
 * Extracting the series instead collapses forty notes onto one real subject,
 * which is the thing a person actually wants to be quizzed on.
 */

export type NoteName = {
  /** The shared prefix across a numbered run of notes. Absent when unnumbered. */
  series?: string;
  /** The number between series and title, when present. */
  index?: number;
  /** The specific note's own name. Falls back to the whole stem. */
  title: string;
};

/**
 * A standalone 1-3 digit token. Deliberately not 4+ digits, so a note named
 * "1984" or "Britain in 1970" keeps its number as part of the title rather than
 * being split into a series.
 */
const INDEX_TOKEN = /^\d{1,3}$/;

/** Separator-only tokens ("-", "–", "—", "·") between the parts. */
const SEPARATOR = /^[-–—·|:]+$/;

/**
 * A separator used as hierarchy: "Podcast - Netherlands - The Revolt".
 *
 * Requires surrounding whitespace so a hyphenated word ("Austro-Hungarian") is
 * never split.
 */
const HIERARCHY = /\s+[-–—|:]\s+/;

/**
 * "History of America 40 First Year of Fighting"
 *   -> { series: 'History of America', index: 40, title: 'First Year of Fighting' }
 *
 * "Britain in the 70s" -> { title: 'Britain in the 70s' }
 */
export function parseNoteName(stem: string): NoteName {
  const cleaned = stem.trim().replace(/\s+/g, ' ');
  const tokens = cleaned.split(' ').filter(Boolean);

  for (let i = 0; i < tokens.length; i += 1) {
    if (!INDEX_TOKEN.test(tokens[i])) continue;

    const before = tokens.slice(0, i).filter((token) => !SEPARATOR.test(token));
    const after = tokens.slice(i + 1).filter((token) => !SEPARATOR.test(token));

    // Both sides must be non-empty. "Chapter 5" and "History of America 40"
    // are left alone rather than guessed at: a series with no title after it
    // would produce a one-word topic like "chapter", which is worse than no
    // series at all.
    if (before.length === 0 || after.length === 0) continue;

    return {
      series: before.join(' '),
      index: Number.parseInt(tokens[i], 10),
      title: after.join(' '),
    };
  }

  /*
    No number, but the name may still be a hierarchy.

    "Podcast - Netherlands - The Revolt That Made the modern world" is one note
    in a run of them, and treating the whole string as the topic produces a slug
    long enough to be truncated mid-word. Taking everything before the last
    separator as the series gives "podcast-netherlands", which groups the run
    and reads properly.

    The cost is that a title legitimately containing " - " ("Cost - Benefit
    Analysis") gets split too. That still yields a real, if narrow, topic, which
    is a better failure than a mangled one.
  */
  const parts = cleaned.split(HIERARCHY).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const title = parts[parts.length - 1];
    const series = parts.slice(0, -1).join(' ');
    if (series && title) return { series, title };
  }

  return { title: cleaned };
}
