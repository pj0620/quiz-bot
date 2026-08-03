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
 * The token that marks position in a series: "4", "Ch.1", "Ch1", "Pt.2", "#3".
 *
 * Capped at 3 digits so a note named "1984" or "Britain in 1970" keeps its
 * number as part of the title rather than being split into a series.
 */
const INDEX_TOKEN = /^(?:ch|pt|part|no|#)?\.?(\d{1,3})$/i;

/**
 * Tokens the series must have before an index is believed, when the index is
 * the LAST thing in the name.
 *
 * "Thinking Fast And Slow Ch.1" has a real series and nothing after the index;
 * "Chapter 5" has neither. Requiring two words is what separates them, and
 * without it the second would yield a topic called "chapter" that matches
 * every numbered note in the vault.
 */
const MIN_TRAILING_SERIES_TOKENS = 2;

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
    const match = INDEX_TOKEN.exec(tokens[i]);
    if (!match) continue;

    const before = tokens.slice(0, i).filter((token) => !SEPARATOR.test(token));
    const after = tokens.slice(i + 1).filter((token) => !SEPARATOR.test(token));

    // Nothing before the number means it is an ordering prefix ("01 Intro"),
    // not a series marker.
    if (before.length === 0) continue;

    /*
      Nothing after the number is fine when the series is substantial.

      "Thinking Fast And Slow Ch.1" is the common case: the whole name is the
      series plus a position, and refusing to split it loses the one piece of
      context that makes the note's contents readable — that these are notes on
      that book. The title then falls back to the full name, which still reads
      properly, and the series is what drives topics and the generation prompt.
    */
    if (after.length === 0 && before.length < MIN_TRAILING_SERIES_TOKENS) continue;

    return {
      series: before.join(' '),
      index: Number.parseInt(match[1], 10),
      title: after.length > 0 ? after.join(' ') : cleaned,
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
