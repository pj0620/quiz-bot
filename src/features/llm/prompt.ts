import type { ParsedNote } from '../../notes/parse';
import { sectionText } from '../../notes/parse';

/**
 * The generation prompt.
 *
 * Pure string building, kept apart from the client so the wording can be
 * iterated on and diffed without touching anything that makes network calls.
 *
 * Two things in here are load-bearing and easy to lose in a later edit:
 *
 *  - Questions must STAND ALONE. The mock generator asks "fill in the gap from
 *    your notes on X", which tests nothing except whether you remember reading
 *    a heading. A question worth answering is answerable months later with no
 *    idea which note it came from.
 *
 *  - The model chooses `choices` and a `correctIndex`, never ids. Asking it to
 *    invent matching identifiers across two fields is a failure mode with no
 *    upside; the parser assigns ids itself, and grading is by id as before.
 */

const FORMAT_SPEC = `Each question is one JSON object. Use whichever format suits the material:

{"format":"multiple-choice","prompt":"...","explanation":"...","difficulty":"core",
 "choices":["...","...","...","..."],"correctIndex":0}
  3-5 choices. Wrong answers must be plausible and about the same subject —
  never joke answers, never "none of the above".

{"format":"true-false","prompt":"...","explanation":"...","difficulty":"intro",
 "correct":true}
  Phrase it as a claim to judge, not a question.

{"format":"short-answer","prompt":"...","explanation":"...","difficulty":"core",
 "modelAnswer":"...","acceptable":["...","..."]}
  "acceptable" holds short forms that should also count as right.

{"format":"list-recall","prompt":"...","explanation":"...","difficulty":"core",
 "items":["...","...","..."]}
  Only when the note genuinely lists things. 2-6 short items.

{"format":"fill-blank","prompt":"...","explanation":"...","difficulty":"intro",
 "sentence":"a sentence from the note","answer":"the exact words to blank out"}
  "answer" MUST appear verbatim inside "sentence". Blank a fact — a figure, a
  name, a date — never a word guessable from grammar.`;

export function buildSystemPrompt(): string {
  return `You write quiz questions from a person's own study notes, to help them revise.

Return JSON only: {"questions":[ ... ]}

${FORMAT_SPEC}

Rules:
1. Every answer must be stated in the note. Never use outside knowledge, and
   never ask about something the note only implies.
2. Questions must stand alone. The reader will see them months later with no
   idea which note they came from, so never write "according to your notes",
   "in this section", or "what does the note say about X". Ask about the
   subject itself.
3. Test understanding, not wording. Prefer "Which side had the stronger economy
   at the start of the war?" over quoting a sentence back with a word missing.
4. Skip anything you cannot verify from the text — the notes may reference
   images that were not included, and a question about those is a guess.
5. "explanation" says why the answer is right, in one or two sentences. It is
   shown after answering, so make it worth reading.
6. "difficulty" is "intro" for a definition or a date, "core" for the main
   ideas, "deep" for something requiring connection between points.
7. Vary the formats. Do not return five of the same kind.
8. Better to return fewer good questions than to pad with weak ones.`;
}

/** Caps the note text sent per request. Generous, but bounds the input cost. */
const MAX_NOTE_CHARS = 12_000;

export function buildUserPrompt(note: ParsedNote, count: number): string {
  const body = note.sections
    .map((section) => {
      const text = sectionText(section);
      if (!text) return '';
      return section.heading ? `## ${section.heading}\n${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_NOTE_CHARS);

  const heading = [note.series, note.title].filter(Boolean).join(' — ');

  /*
    The dropped-embed count is told to the model on purpose. A note whose
    content is half screenshots reads as disjointed, and saying so is what stops
    it inventing connective tissue to explain the gaps.
  */
  const caveat =
    note.droppedEmbeds > 0
      ? `\n\nNote: ${note.droppedEmbeds} image${note.droppedEmbeds === 1 ? '' : 's'} in this note could not be read. Ignore any gap they leave; do not guess at their contents.`
      : '';

  return `Write up to ${count} questions from this note.

# ${heading}

${body}${caveat}`;
}
