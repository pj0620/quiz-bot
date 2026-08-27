import { parseNote, sectionText } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import {
  ANCHORING,
  CIVIL_WAR,
  EMBED_ONLY_NOTE,
  FORT_SUMTER,
} from '../../notes/__fixtures__/sampleNotes';
import { chunkNote, noteOutline, MAX_CHUNKS_PER_NOTE, MIN_NOTE_CHARS } from './chunkNote';

function parse(fixture: { path: string; content: string }) {
  return parseNote(fixture.content, noteStem(fixture.path));
}

/** A synthetic note of `count` headed sections, each roughly `chars` long. */
function syntheticNote(count: number, chars: number) {
  const body = Array.from({ length: count }, (_, index) => {
    const sentence = `Section ${index} records a fact worth remembering about the subject. `;
    return `## Heading ${index}\n\n${sentence.repeat(Math.ceil(chars / sentence.length))}`;
  }).join('\n\n');
  return parseNote(body, 'Synthetic Note');
}

describe('chunkNote', () => {
  it('keeps a typical note in a single call', () => {
    // The common case by far: 74 of 75 notes in the real vault land here.
    for (const fixture of [ANCHORING, FORT_SUMTER, CIVIL_WAR]) {
      expect(chunkNote(parse(fixture))).toHaveLength(1);
    }
  });

  it('splits a note too large for one call', () => {
    const chunks = chunkNote(syntheticNote(12, 1_000));
    expect(chunks.length).toBeGreaterThan(1);
  });

  /**
   * The load-bearing invariant. Concatenating the parts must reproduce exactly
   * the quizzable sections, in order — nothing lost, nothing asked about twice.
   */
  it('covers every quizzable section exactly once, in document order', () => {
    for (const note of [parse(CIVIL_WAR), syntheticNote(9, 900), syntheticNote(30, 500)]) {
      const expected = note.sections.filter((section) => sectionText(section).length > 0);
      const flattened = chunkNote(note).flatMap((chunk) => chunk.sections);
      expect(flattened).toEqual(expected);
    }
  });

  it('never splits a section across two calls', () => {
    // A single section far over budget forms its own oversized part rather than
    // being cut mid-argument.
    const note = syntheticNote(1, 12_000);
    const chunks = chunkNote(note);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sections).toHaveLength(1);
    expect(chunks[0].chars).toBeGreaterThan(4_000);
  });

  it('drops sections with nothing readable in them', () => {
    // CIVIL_WAR's "Confederate Advantages" is a heading over a screenshot.
    const note = parse(CIVIL_WAR);
    const included = chunkNote(note).flatMap((chunk) => chunk.sections);
    expect(note.sections.some((section) => sectionText(section).length === 0)).toBe(true);
    expect(included.every((section) => sectionText(section).length > 0)).toBe(true);
  });

  it('returns nothing for a note with no quizzable content', () => {
    // Signals "skip this note entirely" — no model call, no money spent.
    const note = parseNote('![[Pasted image 1.png]]\n\n![[Pasted image 2.png]]', 'Screenshots');
    expect(chunkNote(note)).toEqual([]);
  });
});

/*
  The regression this section exists for.

  Whether a note is worth a request was decided by testing each SECTION against
  an 80-character floor and dropping the ones that failed — so a note broken
  into four tidy 40-character sections produced no chunks at all, no model call
  was made, and it was reported as "nothing to ask". The same words written as
  one paragraph went through fine. Notes were being punished for being well
  organised, and because the skip is written to the coverage ledger they were
  skipped permanently.
*/
describe('chunkNote — judging the note, not its sections', () => {
  const PODCAST = `Roman Empire Podcast

Key Points
- Marcus Aurelius was the last of the good emperors
- Commodus undid most of it

Timeline
- 180 AD Aurelius dies
- 192 AD Commodus killed

Why It Matters
- Rome never fully recovered
`;

  const SHORT_SECTIONS = `## The Fall

Adam and Eve eat the fruit.
Shame enters the world.

## The Curse

Pain in childbirth.
Toil in the fields.

## The Exile

They are sent east of Eden.
Cherubim guard the way.
`;

  it('generates from a note whose sections are individually short', () => {
    for (const raw of [PODCAST, SHORT_SECTIONS]) {
      const note = parseNote(raw, 'Some Note');
      // Every section is under the old per-section floor…
      expect(note.sections.every((section) => sectionText(section).length < 80)).toBe(true);
      // …and the note is still worth asking about.
      expect(chunkNote(note)).toHaveLength(1);
    }
  });

  it('keeps the short sections rather than sending an empty part', () => {
    const note = parseNote(PODCAST, 'Roman Empire podcast');
    const sent = chunkNote(note).flatMap((chunk) => chunk.sections);

    expect(sent).toHaveLength(note.sections.length);
    expect(sent.map((section) => section.heading)).toContain('Timeline');
  });

  it('gives the same answer however the same words are laid out', () => {
    /*
      The property that was violated. Splitting a note into headed sections is a
      formatting choice; it must not decide whether the note is read at all.
    */
    const asSections = parseNote(SHORT_SECTIONS, 'Note');
    const asProse = parseNote(
      SHORT_SECTIONS.replace(/^## .*$/gm, '').replace(/\n{3,}/g, '\n\n'),
      'Note',
    );

    expect(chunkNote(asSections).length).toBe(chunkNote(asProse).length);
  });

  it('still skips a note with almost nothing in it', () => {
    // The floor has moved from the section to the note; it has not gone away.
    const note = parseNote('Reminder\n\nLook this up later.', 'Stub');
    expect(note.sections.reduce((n, s) => n + sectionText(s).length, 0)).toBeLessThan(MIN_NOTE_CHARS);
    expect(chunkNote(note)).toEqual([]);
  });

  it('counts the whole note towards the floor, not its largest section', () => {
    const note = parseNote(
      '## One\n\nThe first thing happened here.\n\n## Two\n\nThe second thing happened later.\n\n' +
        '## Three\n\nThe third one followed on.\n\n## Four\n\nAnd then it was over.',
      'Note',
    );
    const lengths = note.sections.map((section) => sectionText(section).length);
    const total = lengths.reduce((sum, length) => sum + length, 0);

    // No single section clears the floor; together they comfortably do.
    expect(Math.max(...lengths)).toBeLessThan(MIN_NOTE_CHARS);
    expect(total).toBeGreaterThanOrEqual(MIN_NOTE_CHARS);
    expect(chunkNote(note)).toHaveLength(1);
  });
});

describe('chunkNote — long notes', () => {
  it('respects the per-note ceiling by folding the tail into the last call', () => {
    const chunks = chunkNote(syntheticNote(120, 900));
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_NOTE);

    // Folded in, not dropped — the end of a very long note still gets asked about.
    const note = syntheticNote(120, 900);
    const expected = note.sections.filter((section) => sectionText(section).length > 0);
    expect(chunks.flatMap((chunk) => chunk.sections)).toHaveLength(expected.length);
  });

  it('fills each call up to the budget rather than one section at a time', () => {
    const chunks = chunkNote(syntheticNote(8, 900));
    expect(chunks.length).toBeLessThan(8);
    for (const chunk of chunks) expect(chunk.sections.length).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    const note = syntheticNote(10, 800);
    expect(chunkNote(note)).toEqual(chunkNote(note));
  });
});

describe('noteOutline', () => {
  it('lists every heading so a part knows where it sits', () => {
    const outline = noteOutline(parse(ANCHORING));
    expect(outline).toContain('Two Mechanisms');
    expect(outline).toContain('Anchoring Index');
  });

  it('includes headings whose sections were dropped from the parts', () => {
    // The outline describes the whole note, so a part can tell that material it
    // cannot see exists — which is what stops it over-reaching.
    expect(noteOutline(parse(CIVIL_WAR))).toContain('Confederate Advantages');
  });

  it('skips the unheaded lead-in', () => {
    expect(noteOutline(parse(EMBED_ONLY_NOTE)).every((heading) => !!heading)).toBe(true);
  });
});
