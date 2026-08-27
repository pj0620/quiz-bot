import { parseNote, sectionText, type ParsedNote } from '../../notes/parse';
import { chunkNote, MIN_NOTE_CHARS } from './chunkNote';

/**
 * Shapes of note that come back "nothing to ask".
 *
 * No mocks and no provider: it all happens before a request is sent, in
 * `parseNote` -> `sectionText` -> `chunkNote`. An empty chunk list means
 * `generateNoteInParts` never enters its loop, so the note returns zero
 * questions and throws nothing — reported as done, with coverage recorded. That
 * is reversible: coverage is keyed on the blob hash, so writing something into
 * the note makes `selectNotes` see it as 'changed' and read it again.
 *
 * MEASURED AGAINST THE REAL VAULT (75 notes, Aug 2026): four notes are skipped
 * and all four are genuine stubs — one is empty, one reads "In genesis 3", one
 * "Floating furniture". The 80-character floor is doing exactly its job on
 * those, and no note in the vault contains a table at all.
 *
 * So the cases marked LATENT below are real defects in the parser that no note
 * currently triggers. They are worth pinning precisely because of that: the
 * vault is edited by hand in Obsidian, and the day a table or a heading-only
 * note appears it will be skipped silently with nothing to point at. Each names
 * the behaviour it should have, so a fix flips the assertion rather than
 * deleting the test.
 */

const STEM = 'Old Testament 4 When things go wrong in the garden of eden';

function parse(body: string): ParsedNote {
  return parseNote(body, STEM);
}

/** What the size check in `chunkNote` actually measures. */
function readableChars(note: ParsedNote): number {
  return note.sections.reduce((total, section) => total + sectionText(section).length, 0);
}

/** Characters of real content sitting in headings, which the check cannot see. */
function headingChars(note: ParsedNote): number {
  return note.sections.reduce((total, section) => total + (section.heading?.length ?? 0), 0);
}

describe('a note written as a table', () => {
  const note = parse(`## Genesis 3

The fall of man is told in three movements.

| Verse | Event |
| --- | --- |
| 3:1 | The serpent questions Eve |
| 3:6 | Eve eats the fruit and gives some to Adam |
| 3:23 | God expels them from the garden of Eden |
`);

  it('LATENT: throws every table row away without counting it', () => {
    /*
      `TABLE_ROW` in `parse.ts` flushes and continues, so the row's cells are
      never captured as content. Unlike an image embed — which is dropped but
      COUNTED, and reported to the model as a known gap — a table leaves no
      trace at all. Three verses of real material become nothing.

      WANT: the cells parsed as content (a row is a natural definition pair), or
      at minimum counted like a dropped embed so the loss is visible.
    */
    expect(sectionText(note.sections[0])).toBe('The fall of man is told in three movements.');
    expect(sectionText(note.sections[0])).not.toContain('serpent');
    expect(note.droppedEmbeds).toBe(0);
  });

  it('LATENT: skips the note entirely, so no request is ever sent', () => {
    // 43 readable characters out of a 200-character note, all of it the one
    // prose line. Under the 80-character floor, so the note is never read.
    expect(readableChars(note)).toBeLessThan(MIN_NOTE_CHARS);
    expect(chunkNote(note)).toHaveLength(0);
  });
});

describe('a note whose content lives in its headings', () => {
  const note = parse(`# When things go wrong in the garden of eden

## The serpent is craftier than any beast God made
Genesis 3:1

## Eve eats the fruit and gives some to Adam
Genesis 3:6

## God curses the serpent and expels them from Eden
Genesis 3:23
`);

  it('LATENT: heading text is invisible to the size check', () => {
    /*
      `sectionText` deliberately returns only block content, which is right for
      excerpts — an excerpt should not repeat the heading above it. But
      `chunkNote` sums the same function to decide whether a note is worth a
      request, and headings are exactly where a well-organised note puts its
      meaning. Here almost all the content is in headings and the note measures
      as nearly empty.

      WANT: the worth-a-request check counts headings; the excerpt still doesn't.
    */
    expect(headingChars(note)).toBeGreaterThan(140);
    expect(readableChars(note)).toBeLessThan(40);
  });

  it('LATENT: skips a note that plainly has three things to ask about', () => {
    expect(chunkNote(note)).toHaveLength(0);
  });
});

describe('a note of terse title-case lines', () => {
  /*
    The same loss by a different route. `looksLikeHeading` promotes a short,
    title-cased, unpunctuated line followed by content into a section heading —
    and once promoted, its text leaves `sectionText` and stops counting. Notes
    written one thought per line are the most exposed to this.
  */
  const note = parse(`Adam and Eve
God places them in the garden
Tree of Knowledge
Serpent tempts Eve
`);

  it('LATENT: promotes ordinary content lines to headings, where they stop counting', () => {
    const headings = note.sections.map((section) => section.heading).filter(Boolean);
    expect(headings).toContain('Adam and Eve');
    expect(headings).toContain('Tree of Knowledge');
    // Those two lines are content, not structure, and are now uncounted.
    expect(headingChars(note)).toBeGreaterThan(20);
  });

  it('LATENT: skips the note once enough lines have been promoted', () => {
    expect(chunkNote(note)).toHaveLength(0);
  });
});

describe('shapes that survive, for contrast', () => {
  // Worth pinning: these prove the failures above are about PARSING, not about
  // the notes being genuinely too thin. The same material in another shape is
  // read without complaint.

  it('reads the same content as bullets', () => {
    const note = parse(`## The Fall
- The serpent questions whether God really said they may not eat
- Eve eats the fruit and gives some to Adam
- God curses the serpent and expels them from Eden
`);
    expect(chunkNote(note)).toHaveLength(1);
  });

  it('reads the same content as prose', () => {
    const note = parse(`## The Fall

The serpent tempts Eve into eating from the tree of knowledge, and she gives
some to Adam. God curses the serpent, and expels them both from the garden.
`);
    expect(chunkNote(note)).toHaveLength(1);
  });

  it('reads an Obsidian callout, which is a blockquote underneath', () => {
    const note = parse(`## The Fall

> [!note] The serpent
> The serpent is the craftiest of the beasts God made, and he tempts Eve
> by asking whether God really said they may not eat of any tree.
`);
    expect(chunkNote(note)).toHaveLength(1);
  });

  it('reads indented sub-bullets', () => {
    const note = parse(`## The Fall
- The serpent
    - craftiest beast, tempts Eve with a question
- The fruit
    - Eve eats, then gives some to Adam, and both are expelled
`);
    expect(chunkNote(note)).toHaveLength(1);
  });
});

describe('an image-only note, which is the one legitimate case', () => {
  it('is skipped, and says so through droppedEmbeds', () => {
    // The behaviour "nothing to ask" was designed for, and the only one of these
    // shapes where a green tick and no request is the right answer.
    const note = parse(`## The Fall

![[Pasted image 20260707210812.png]]

## The Curse

![[Pasted image 20260707210904.png]]
`);
    expect(chunkNote(note)).toHaveLength(0);
    // Unlike the table, this loss is counted — and reported to the model.
    expect(note.droppedEmbeds).toBe(2);
  });
});
