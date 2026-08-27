/**
 * Locating a model-supplied quote inside a note.
 *
 * The model is asked to return the passage a question came from verbatim, but
 * "verbatim" from a language model means "almost": it re-wraps lines, collapses
 * the double spaces in someone's typing, swaps a straight quote for a curly one,
 * and drops a trailing full stop. Matching on the raw string finds nothing most
 * of the time.
 *
 * So matching is done on a NORMALISED copy while keeping an index map back to
 * the original, which is what lets the highlight land on the real characters —
 * with the note's own punctuation and spacing intact on screen.
 */

export type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

/** Enough of a lead-in to be confident it isn't a coincidence. */
const MIN_PREFIX_CHARS = 24;

type Normalized = {
  text: string;
  /** `map[i]` is the index in the ORIGINAL string of normalised character `i`. */
  map: number[];
};

/**
 * Lowercases, collapses whitespace, and folds the punctuation a model is most
 * likely to alter. Every kept character records where it came from.
 */
function normalize(input: string): Normalized {
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // leading whitespace is dropped entirely

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        chars.push(' ');
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }

    lastWasSpace = false;
    chars.push(foldChar(char));
    map.push(i);
  }

  // A trailing space would stop an otherwise-good match at the end of a note.
  while (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    map.pop();
  }

  return { text: chars.join('').toLowerCase(), map };
}

/** Smart punctuation and dashes to their plain equivalents. */
function foldChar(char: string): string {
  switch (char) {
    case '‘':
    case '’':
    case 'ʼ':
      return "'";
    case '“':
    case '”':
      return '"';
    case '–':
    case '—':
      return '-';
    case '…':
      return '.';
    default:
      return char;
  }
}

/** Trailing punctuation a model adds or drops freely. */
function trimEdges(value: string): string {
  return value.replace(/^[\s"'“”‘’(\[]+/, '').replace(/[\s"'“”‘’.,;:!?)\]…]+$/, '');
}

/**
 * The original-string range covering `quote`, or null when it isn't there.
 *
 * Falls back to matching just the opening of the quote, which rescues the
 * common case of a model quoting a long passage and paraphrasing its tail.
 */
export function findQuoteRange(
  text: string,
  quote: string,
): { start: number; end: number } | null {
  const cleanedQuote = trimEdges(quote);
  if (!cleanedQuote) return null;

  const haystack = normalize(text);
  const needle = normalize(cleanedQuote);
  if (needle.text.length === 0 || haystack.text.length === 0) return null;

  const toRange = (at: number, length: number) => {
    const start = haystack.map[at];
    // `map` points at the START of each kept character, so the end of the match
    // is one past the last one's original index.
    let end = haystack.map[at + length - 1] + 1;

    /*
      Absorb punctuation sitting immediately after the match.

      The quote was trimmed of trailing punctuation before searching, because a
      model adds and drops full stops freely. Without putting it back, a
      highlight ends one character short of the sentence it covers, which looks
      like a bug rather than a tolerance.
    */
    while (end < text.length && /[.,;:!?)\]"'”’…]/.test(text[end])) end += 1;

    return { start, end };
  };

  const exact = haystack.text.indexOf(needle.text);
  if (exact !== -1) return toRange(exact, needle.text.length);

  if (needle.text.length > MIN_PREFIX_CHARS) {
    // Cut at a word boundary so the prefix can't end mid-word and match a
    // different word that merely starts the same way.
    const cut = needle.text.lastIndexOf(' ', Math.max(MIN_PREFIX_CHARS, Math.floor(needle.text.length / 2)));
    if (cut > MIN_PREFIX_CHARS) {
      const prefix = needle.text.slice(0, cut);
      const at = haystack.text.indexOf(prefix);
      if (at !== -1) return toRange(at, prefix.length);
    }
  }

  return null;
}

/**
 * Splits `text` for rendering, with at most one highlighted run.
 *
 * Always returns something renderable: an absent or unfindable quote yields the
 * whole text as a single plain segment, so a caller never has to branch.
 */
export function highlightSegments(text: string, quote?: string): HighlightSegment[] {
  if (!text) return [];
  if (!quote) return [{ text, highlighted: false }];

  const range = findQuoteRange(text, quote);
  if (!range) return [{ text, highlighted: false }];

  const segments: HighlightSegment[] = [];
  if (range.start > 0) segments.push({ text: text.slice(0, range.start), highlighted: false });
  segments.push({ text: text.slice(range.start, range.end), highlighted: true });
  if (range.end < text.length) segments.push({ text: text.slice(range.end), highlighted: false });
  return segments;
}

export type NotePassage = {
  segments: HighlightSegment[];
  /**
   * True for the FIRST passage the quote reaches into.
   *
   * The renderer uses it as the thing to scroll to. It has to be a passage
   * rather than the highlighted run itself, because the run is an inline span
   * inside a `Text` and an inline span has no position anything can measure.
   */
  startsHighlight: boolean;
};

/** Blank lines separate passages; single newlines stay inside one. */
const PASSAGE_BREAK = /\n[ \t]*\n+/g;

/**
 * Splits text into passages, marking where the quote falls.
 *
 * Rendering the note as one `Text` with inline spans gives the right typography
 * and nothing that can be located afterwards — so expanding to the full note
 * left the highlight somewhere below the fold with no way to scroll to it.
 * Passages are laid out as separate views, which can be measured, while the
 * spans inside each one keep the prose flowing normally.
 */
export function notePassages(text: string, quote?: string): NotePassage[] {
  if (!text) return [];

  const range = quote ? findQuoteRange(text, quote) : null;
  const passages: NotePassage[] = [];
  let seenHighlight = false;

  const push = (start: number, end: number) => {
    const body = text.slice(start, end);
    if (!body.trim()) return;

    const from = range ? Math.max(start, range.start) : 0;
    const to = range ? Math.min(end, range.end) : 0;

    if (!range || from >= to) {
      passages.push({ segments: [{ text: body, highlighted: false }], startsHighlight: false });
      return;
    }

    const segments: HighlightSegment[] = [];
    if (from > start) segments.push({ text: text.slice(start, from), highlighted: false });
    segments.push({ text: text.slice(from, to), highlighted: true });
    if (to < end) segments.push({ text: text.slice(to, end), highlighted: false });

    passages.push({ segments, startsHighlight: !seenHighlight });
    seenHighlight = true;
  };

  let cursor = 0;
  PASSAGE_BREAK.lastIndex = 0;
  let match = PASSAGE_BREAK.exec(text);
  while (match !== null) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
    match = PASSAGE_BREAK.exec(text);
  }
  push(cursor, text.length);

  return passages;
}

/**
 * A window around the quote, for the collapsed view.
 *
 * Centred on the match rather than taken from the top of the note, because the
 * passage a question came from is usually nowhere near the first paragraph —
 * which is exactly what made the old fixed 600-character excerpt useless.
 */
export function excerptAround(
  text: string,
  quote: string | undefined,
  maxChars: number,
): { text: string; quote?: string; clippedStart: boolean; clippedEnd: boolean } {
  if (text.length <= maxChars) {
    return { text, quote, clippedStart: false, clippedEnd: false };
  }

  const range = quote ? findQuoteRange(text, quote) : null;
  if (!range) {
    return { text: text.slice(0, maxChars), quote, clippedStart: false, clippedEnd: true };
  }

  const quoteLength = range.end - range.start;
  const spare = Math.max(0, maxChars - quoteLength);
  /*
    Weighted towards what comes AFTER the quote rather than split evenly.

    An even split buries the highlight in the middle of the block, so the reader
    scrolls the section into view and still has to hunt down past several lines
    of lead-in to find it. A third in front is enough to show the quote in
    context while putting it near the top of what they see.
  */
  const before = Math.floor(spare * 0.35);
  let start = Math.max(0, range.start - before);
  let end = Math.min(text.length, range.end + (spare - before));

  // Snap outwards to word boundaries so the window doesn't open mid-word.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < range.start) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space !== -1 && space > range.end) end = space;
  }

  return {
    text: text.slice(start, end),
    quote,
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  };
}
