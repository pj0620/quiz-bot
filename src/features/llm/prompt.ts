import type { ParsedNote } from '../../notes/parse';
import { sectionText } from '../../notes/parse';

/**
 * The generation prompt.
 *
 * Pure string building, kept apart from the client so the wording can be
 * iterated on and diffed without touching anything that makes network calls.
 *
 * Three things in here are load-bearing and easy to lose in a later edit:
 *
 *  - Questions must STAND ALONE. The mock generator asks "fill in the gap from
 *    your notes on X", which tests nothing except whether you remember reading
 *    a heading. A question worth answering is answerable months later with no
 *    idea which note it came from.
 *
 *  - The note is read as SHORTHAND, not as a specification. "Priming happens in
 *    S1" is meaningless in isolation and obvious under the filename "Thinking
 *    Fast and Slow 4 — The associative machine.md". An earlier version of this
 *    prompt forbade outside knowledge, which meant terse notes produced terse,
 *    useless questions. The filename is the key that unlocks them.
 *
 *  - That filename is passed through VERBATIM, never split into series/title.
 *    A hand-written vault name already holds the book, the position in it and
 *    the subject; parsing it can only lose one of those, and losing the book is
 *    exactly what makes "S1" unresolvable again.
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

These are PERSONAL NOTES, jotted down fast while reading or listening. They are
terse, use private shorthand, drop words, and assume everything the writer had
in their head at the time. They are not a specification and not an article.
Your job is to work out what they MEAN and quiz on that.

Read every line in the context of the note's FILENAME, which the writer chose by
hand and which usually names the book, lecture or podcast, where in it this note
falls, and what it covers. In a note filed as "Thinking Fast and Slow 4 — The
associative machine.md", the line "Priming happens in S1" means priming — the
psychological effect — occurs in System 1, as Kahneman uses those terms. Expand
abbreviations, resolve pronouns, connect a fragment to the heading above it, and
fill in what the writer obviously meant. Read between the lines. Assume the
sensible reading.

The note also tells you WHAT THIS PERSON IS STUDYING. Treat every subject it
raises as fair game, not just the specific facts it happens to record. If a note
mentions priming in Thinking Fast and Slow, this person is studying priming in
that book — so you may ask about important things about priming in that book
even where this note does not spell them out.

Return JSON only: {"questions":[ ... ]}

${FORMAT_SPEC}

Rules:
1. Interpret generously, but stay on this note's subjects. Expanding "S1" to
   System 1 is the job. Wandering off to a topic the note never raises is not.
2. Questions must stand alone. The reader will see them months later with no
   idea which note they came from, so never write "according to your notes",
   "in this section", or "what does the note say about X". Ask about the
   subject itself, using its real names rather than the note's shorthand.
3. Test understanding, not wording. Prefer "Which side had the stronger economy
   at the start of the war?" over quoting a sentence back with a word missing.
4. Only assert what you are confident is true of the actual subject or source.
   Where the note is too fragmentary to tell what was meant, and you cannot
   resolve it from the title and surrounding lines, leave it alone. Never guess
   at the contents of an image that was not included.
5. When a question goes beyond what the note records, say so briefly in the
   explanation — something like "not in your notes, but ...". The reader should
   be able to tell their own material from the wider subject.
6. "explanation" says why the answer is right, in one or two sentences. It is
   shown after answering, so make it worth reading.
7. "difficulty" is "intro" for a definition or a date, "core" for the main
   ideas, "deep" for something requiring connection between points.
8. Vary the formats. Do not return five of the same kind.
9. Better to return fewer good questions than to pad with weak ones.`;
}

/** Caps the note text sent per request. Generous, but bounds the input cost. */
const MAX_NOTE_CHARS = 12_000;

export function buildUserPrompt(note: ParsedNote, count: number, filename: string): string {
  const body = note.sections
    .map((section) => {
      const text = sectionText(section);
      if (!text) return '';
      return section.heading ? `## ${section.heading}\n${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_NOTE_CHARS);

  /*
    The filename goes in exactly as written — extension included, nothing split
    off, nothing tidied.

    It is the single most useful line here: it is what turns "S1" into System 1
    and tells the model which book's account of a concept is being studied. An
    earlier version sent a derived `Series:`/`Title:` pair instead, and any note
    whose name didn't match the expected shape arrived with the book silently
    missing — the one piece of context the note cannot do without.

    Tags and wiki-links come from the note's own body rather than from its name,
    so they are still worth stating separately. A `[[Priming]]` link is the
    writer saying this note connects to that idea, which is exactly the signal
    for what is worth asking about.
  */
  const context: string[] = [`File: ${filename}`];
  if (note.tags.length > 0) context.push(`Tags: ${note.tags.join(', ')}`);
  if (note.links.length > 0) context.push(`Links to: ${note.links.join(', ')}`);

  /*
    The dropped-embed count is told to the model on purpose. A note whose
    content is half screenshots reads as disjointed, and saying so is what stops
    it inventing connective tissue to explain the gaps.
  */
  const caveat =
    note.droppedEmbeds > 0
      ? `\n\n(${note.droppedEmbeds} image${note.droppedEmbeds === 1 ? '' : 's'} in this note could not be read. Ignore any gap they leave; do not guess at their contents.)`
      : '';

  return `${context.join('\n')}

--- the note, as written ---
${body}
--- end of note ---${caveat}

Write up to ${count} questions. Read the note in the context above: expand its
shorthand, and treat the subjects it raises as the topic, not just the specific
lines it happens to contain.`;
}
