import { sectionText, type NoteSection, type ParsedNote } from '../../notes/parse';

/**
 * Splitting one note across several model calls.
 *
 * Two separate problems are solved here, and it is worth being clear that the
 * second is the one that actually bites.
 *
 * The obvious problem is INPUT: a note longer than what we send was previously
 * truncated by a blunt `.slice()`, silently, with the model never told. Only one
 * note in a 75-note vault is big enough for that.
 *
 * The real problem is OUTPUT. One request can only be trusted to produce so
 * many questions before it risks being cut off — and a cut-off reply is
 * discarded whole, so the cost is total. That ceiling applies to a 4,000
 * character note just as much as a 40,000 character one, which means a single
 * call flattens every rich note down to the same number. Splitting is what
 * restores the difference between a dense chapter and a passing thought.
 *
 * How many questions each part yields is NOT decided here. That is the model's
 * judgement, made from the material in front of it — this module only decides
 * how much material to put in front of it at a time.
 */

/**
 * Readable characters per call.
 *
 * 2,500, down from 4,000, because a note's question ceiling is
 * `chunks * MAX_QUESTIONS_PER_CALL` — so how much material goes in one request
 * decides how thoroughly a long note can be covered, not just whether it fits.
 *
 * Re-measured over the real vault (75 notes): at 4,000 characters, 88% of notes
 * were a single call and therefore capped at one call's worth of questions,
 * which is precisely where the dense History of America notes were running out
 * of room. At 2,500 the median note is still one call — a thin note must not be
 * split into two thin requests — while the notes above the median split and get
 * proportionally more room. It costs 1.37 calls per note against 1.08.
 *
 * Chunking still does not decide how many questions to write. It decides how
 * much material to show at a time, which sets the ceiling the model works under.
 */
export const MAX_CHUNK_CHARS = 2_500;

/**
 * Cost ceiling per note. `MAX_CHUNKS_PER_NOTE * MAX_CHUNK_CHARS` is 32,000
 * readable characters — comfortably more than the largest note in the vault, so
 * in practice nothing is truncated at all.
 */
export const MAX_CHUNKS_PER_NOTE = 8;

/**
 * Readable characters a WHOLE NOTE needs before it is worth a request.
 *
 * Judged on the note, never on its sections — which is the bug this constant
 * exists to close. `isQuizzable` asks "is this section only a screenshot?" at 80
 * characters, and that is the right question for the mock generator, which
 * builds a question per section. Applying it here meant a note broken into four
 * tidy 40-character sections was dropped whole, with no request ever sent, while
 * the same 160 characters written as one paragraph sailed through. Notes were
 * being punished for being well organised.
 *
 * The threshold is deliberately low. Sending a request for a note with nothing
 * in it wastes a fraction of a penny; skipping a real note loses material the
 * reader wrote — and because the skip is recorded as coverage, loses it until
 * the note is edited. The two mistakes are nowhere near equally bad.
 */
export const MIN_NOTE_CHARS = 80;

export type NoteChunk = {
  /** A contiguous run of the note's sections, in document order. */
  sections: NoteSection[];
  /** Readable characters across those sections. */
  chars: number;
};

/** Readable characters in a section — markdown, code, tables and embeds already gone. */
function charsOf(section: NoteSection): number {
  return sectionText(section).length;
}

/**
 * Splits a note into the parts one model call each should cover.
 *
 * Returns an empty array when the note holds nothing worth asking about, which
 * the caller uses to skip the note without spending a request.
 *
 * Sections are the atom: one is never split across two parts. A section large
 * enough to exceed the budget on its own simply forms an oversized part rather
 * than being cut mid-thought, because half a section is worse input than a big
 * one — the model would be asked to quiz material that stops mid-argument.
 */
export function chunkNote(note: ParsedNote, budgetChars = MAX_CHUNK_CHARS): NoteChunk[] {
  /*
    Only EMPTY sections are dropped — the screenshot-only ones, where the parser
    has established there is no text at all.

    A short section is kept. "180 AD Aurelius dies" is twenty characters and a
    perfectly good question; its heading is context the model wants; and it
    costs almost nothing to include next to the sections around it. What it must
    not do is be judged on its own, because whether a NOTE is worth a request is
    a question about the note.
  */
  const sections = note.sections.filter((section) => sectionText(section).length > 0);
  const readable = sections.reduce((total, section) => total + charsOf(section), 0);
  if (readable < MIN_NOTE_CHARS) return [];

  const chunks: NoteChunk[] = [];
  let current: NoteSection[] = [];
  let currentChars = 0;

  for (const section of sections) {
    const chars = charsOf(section);

    // Close the current part when adding this section would overrun it. The
    // check is skipped for an empty part so an oversized section still lands
    // somewhere rather than looping.
    if (current.length > 0 && currentChars + chars > budgetChars) {
      chunks.push({ sections: current, chars: currentChars });
      current = [];
      currentChars = 0;
    }

    current.push(section);
    currentChars += chars;
  }

  if (current.length > 0) chunks.push({ sections: current, chars: currentChars });

  /*
    Beyond the ceiling, the tail is folded into the last part rather than
    dropped. That part goes over budget, but the alternative is losing the end
    of the note entirely — and being over-long is a soft failure where being
    absent is a silent one.
  */
  if (chunks.length > MAX_CHUNKS_PER_NOTE) {
    const kept = chunks.slice(0, MAX_CHUNKS_PER_NOTE);
    const overflow = chunks.slice(MAX_CHUNKS_PER_NOTE);
    const last = kept[kept.length - 1];
    kept[kept.length - 1] = {
      sections: [...last.sections, ...overflow.flatMap((chunk) => chunk.sections)],
      chars: last.chars + overflow.reduce((sum, chunk) => sum + chunk.chars, 0),
    };
    return kept;
  }

  return chunks;
}

/** Every heading in the note, so a part can be told where it sits in the whole. */
export function noteOutline(note: ParsedNote): string[] {
  return note.sections
    .map((section) => section.heading)
    .filter((heading): heading is string => !!heading);
}
