import { excerptAround, findQuoteRange, highlightSegments, notePassages } from './highlight';

const NOTE =
  'Lee asks Grant for terms of surrender. They meet at Appomattox Parlor at April 9, 1865.\n' +
  'Lincoln instructed Grant to give very generous terms to Lee.\n' +
  'Official surrender happened three days later.';

describe('findQuoteRange', () => {
  it('finds an exact quote and reports the original offsets', () => {
    const range = findQuoteRange(NOTE, 'Lincoln instructed Grant to give very generous terms to Lee.');
    expect(range).not.toBeNull();
    expect(NOTE.slice(range!.start, range!.end)).toBe(
      'Lincoln instructed Grant to give very generous terms to Lee.',
    );
  });

  /* The model re-wraps and re-spaces almost every quote it returns. */
  it('matches across a line break in the note', () => {
    const range = findQuoteRange(NOTE, 'April 9, 1865. Lincoln instructed Grant');
    expect(range).not.toBeNull();
    expect(NOTE.slice(range!.start, range!.end)).toContain('\n');
  });

  it('ignores case and collapsed whitespace', () => {
    const range = findQuoteRange(NOTE, 'lincoln    INSTRUCTED   grant');
    expect(range).not.toBeNull();
    expect(NOTE.slice(range!.start, range!.end)).toBe('Lincoln instructed Grant');
  });

  it('tolerates smart punctuation swaps', () => {
    const curly = 'Grant’s terms were generous — everyone went home.';
    const range = findQuoteRange(curly, "Grant's terms were generous - everyone went home.");
    expect(range).not.toBeNull();
  });

  it('tolerates added or missing trailing punctuation', () => {
    expect(findQuoteRange(NOTE, 'Lee asks Grant for terms of surrender')).not.toBeNull();
    expect(findQuoteRange(NOTE, '"Official surrender happened three days later."')).not.toBeNull();
  });

  /* The rescue case: a long quote whose tail the model paraphrased. */
  it('falls back to the opening when the tail drifts', () => {
    const range = findQuoteRange(
      NOTE,
      'Lincoln instructed Grant to give very generous terms and told him to be magnanimous in victory',
    );
    expect(range).not.toBeNull();
    expect(NOTE.slice(range!.start, range!.end)).toContain('Lincoln instructed Grant');
  });

  it('returns null when the quote is genuinely absent', () => {
    expect(findQuoteRange(NOTE, 'Sherman marched to the sea through Georgia')).toBeNull();
  });

  it('returns null for an empty or punctuation-only quote', () => {
    expect(findQuoteRange(NOTE, '')).toBeNull();
    expect(findQuoteRange(NOTE, '  "" ')).toBeNull();
  });

  it('will not match a short prefix by coincidence', () => {
    // Shorter than the prefix floor, so the fallback must not fire.
    expect(findQuoteRange(NOTE, 'Lee was tired')).toBeNull();
  });
});

describe('highlightSegments', () => {
  it('splits into before, highlight and after', () => {
    const segments = highlightSegments(NOTE, 'Lincoln instructed Grant');
    expect(segments).toHaveLength(3);
    expect(segments[1].highlighted).toBe(true);
    expect(segments[1].text).toBe('Lincoln instructed Grant');
    expect(segments.filter((s) => s.highlighted)).toHaveLength(1);
  });

  /* Reassembly must be lossless — this is displayed text. */
  it('preserves the original text exactly when joined', () => {
    expect(highlightSegments(NOTE, 'Lincoln instructed Grant').map((s) => s.text).join('')).toBe(NOTE);
    expect(highlightSegments(NOTE, 'nothing like this').map((s) => s.text).join('')).toBe(NOTE);
  });

  it('returns one plain segment with no quote or no match', () => {
    expect(highlightSegments(NOTE)).toEqual([{ text: NOTE, highlighted: false }]);
    expect(highlightSegments(NOTE, 'absent')).toEqual([{ text: NOTE, highlighted: false }]);
  });

  it('handles a quote at the very start with no leading segment', () => {
    const segments = highlightSegments(NOTE, 'Lee asks Grant');
    expect(segments[0].highlighted).toBe(true);
  });

  it('returns nothing for empty text', () => {
    expect(highlightSegments('', 'anything')).toEqual([]);
  });
});

describe('excerptAround', () => {
  const long = `${'filler words here. '.repeat(40)}THE KEY PASSAGE IS HERE. ${'more filler. '.repeat(40)}`;

  it('returns the whole text when it already fits', () => {
    const result = excerptAround(NOTE, 'Lincoln', 10_000);
    expect(result.text).toBe(NOTE);
    expect(result.clippedStart).toBe(false);
    expect(result.clippedEnd).toBe(false);
  });

  /* The reason this exists: the passage is usually nowhere near the top. */
  it('centres the window on the quote rather than the start of the note', () => {
    const result = excerptAround(long, 'THE KEY PASSAGE IS HERE.', 200);
    expect(result.text).toContain('THE KEY PASSAGE IS HERE.');
    expect(result.clippedStart).toBe(true);
    expect(result.clippedEnd).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(260);
  });

  it('falls back to the opening when the quote cannot be found', () => {
    const result = excerptAround(long, 'not in here at all', 200);
    expect(result.clippedStart).toBe(false);
    expect(result.clippedEnd).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(200);
  });

  it('keeps the quote findable in the windowed text', () => {
    const result = excerptAround(long, 'THE KEY PASSAGE IS HERE.', 200);
    expect(findQuoteRange(result.text, 'THE KEY PASSAGE IS HERE.')).not.toBeNull();
  });
});

describe('notePassages', () => {
  const NOTE = `Anchoring

Occurs when people consider a value before estimating one themselves.

A message unless immediately rejected as a lie always has an influence.

## Freedom

What agency do you truly possess.`;

  it('splits on blank lines and keeps single newlines inside a passage', () => {
    const passages = notePassages('One\nstill one\n\nTwo');
    expect(passages).toHaveLength(2);
    expect(passages[0].segments[0].text).toBe('One\nstill one');
    expect(passages[1].segments[0].text).toBe('Two');
  });

  it('drops blank passages rather than rendering empty blocks', () => {
    expect(notePassages('One\n\n\n\n   \n\nTwo')).toHaveLength(2);
  });

  it('marks only the passage the quote starts in', () => {
    const passages = notePassages(NOTE, 'A message unless immediately rejected as a lie');
    const marked = passages.filter((passage) => passage.startsHighlight);

    expect(marked).toHaveLength(1);
    expect(marked[0].segments.some((segment) => segment.highlighted)).toBe(true);
  });

  /*
    The point of the whole exercise. Rendering the note as one block gives
    correct typography and nothing that can be located afterwards, so expanding
    to the full note left the highlight below the fold with no way to scroll to
    it. A passage is a real view; an inline span is not.
  */
  it('gives the highlight somewhere measurable, part-way down a long note', () => {
    const passages = notePassages(NOTE, 'A message unless immediately rejected as a lie');
    const index = passages.findIndex((passage) => passage.startsHighlight);

    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(passages.length - 1);
  });

  it('splits the passage around the quote rather than highlighting all of it', () => {
    const passages = notePassages('Before it. The key line here. After it.', 'The key line here.');
    const target = passages.find((passage) => passage.startsHighlight);

    expect(target?.segments.map((segment) => segment.highlighted)).toEqual([false, true, false]);
    expect(target?.segments[1].text).toBe('The key line here.');
  });

  it('marks nothing when the quote is absent, and still renders the note', () => {
    const passages = notePassages(NOTE, 'a sentence this note never contained anywhere');
    expect(passages.every((passage) => !passage.startsHighlight)).toBe(true);
    expect(passages.length).toBeGreaterThan(1);
  });

  it('marks nothing when there is no quote at all', () => {
    const passages = notePassages(NOTE);
    expect(passages.every((passage) => !passage.startsHighlight)).toBe(true);
  });

  it('loses no text', () => {
    // Passage boundaries are blank lines, so rejoining on them must give the
    // note back — a highlight that quietly dropped a paragraph would be worse
    // than no highlight.
    const rejoined = notePassages(NOTE, 'always has an influence')
      .map((passage) => passage.segments.map((segment) => segment.text).join(''))
      .join('\n\n');
    expect(rejoined).toBe(NOTE.split(/\n[ \t]*\n+/).join('\n\n'));
  });

  it('handles a quote spanning two passages', () => {
    const passages = notePassages('First half here.\n\nSecond half here.', 'First half here.\n\nSecond half');
    const marked = passages.filter((passage) => passage.startsHighlight);

    // Still exactly one scroll target, even though both passages are tinted.
    expect(marked).toHaveLength(1);
    expect(passages.filter((p) => p.segments.some((s) => s.highlighted))).toHaveLength(2);
  });

  it('returns nothing for empty text', () => {
    expect(notePassages('', 'anything')).toEqual([]);
  });
});

describe('excerptAround — where the highlight lands in the window', () => {
  const long =
    'Opening filler. '.repeat(60) + 'THE KEY PASSAGE IS HERE. ' + 'Trailing filler. '.repeat(60);

  it('puts the quote in the first half of the window, not the middle', () => {
    /*
      The complaint this answers: the section scrolls into view and the
      highlight is still below the fold, so it has to be hunted for.
    */
    const result = excerptAround(long, 'THE KEY PASSAGE IS HERE.', 700);
    const at = findQuoteRange(result.text, 'THE KEY PASSAGE IS HERE.');

    expect(at).not.toBeNull();
    expect(at!.start / result.text.length).toBeLessThan(0.45);
  });

  it('still shows some of what came before it', () => {
    // Not flush to the top either: a quote with no lead-in reads as a fragment.
    const result = excerptAround(long, 'THE KEY PASSAGE IS HERE.', 700);
    expect(findQuoteRange(result.text, 'THE KEY PASSAGE IS HERE.')!.start).toBeGreaterThan(0);
    expect(result.clippedStart).toBe(true);
  });

  it('uses the whole budget, not just the part before the quote', () => {
    const result = excerptAround(long, 'THE KEY PASSAGE IS HERE.', 700);
    expect(result.text.length).toBeGreaterThan(600);
    expect(result.text.length).toBeLessThanOrEqual(700);
  });
});
