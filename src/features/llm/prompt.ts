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
 *    Which is why rule 2 now spends thirty lines on what that phrase does NOT
 *    mean. Told only "stand alone", the model read it as "refer to nothing
 *    outside the question" and stripped the anchors — producing "Why is making
 *    the first offer useful in a negotiation?" with no hint that Kahneman is
 *    the authority being tested, and "What held the Democrats' diverse social
 *    coalition together?" with no century attached. Standing alone means
 *    CARRYING your context, which is the opposite of omitting it.
 *
 *  - Standing alone was not enough on its own. It caught the missing book and
 *    the missing century; it did not catch "once you know the two lines are
 *    equal you can choose to see them as equal", which names its book, its
 *    author and its idea and is STILL unanswerable a year later, because the
 *    lines were on a page the reader will never see again. THE FIVE-YEAR TEST
 *    is the rule that catches it, and it asks two things of every stem: can the
 *    reader still tell what is being asked, and was the thing asked about ever
 *    worth carrying? An example is how an idea was delivered; the idea is the
 *    material, and the sample size and the diagram are packaging.
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
 *  - TRUE/FALSE IS ASKED FOR AS A PAIR — a claim and a distortion of it — and
 *    `parseQuestions` flips a seeded coin over which one the reader sees. Asked
 *    for a single statement, the model writes what the note says: nearly every
 *    one came back true, and "true" became a free guess. The half that is
 *    easier to miss is that its rare false statements were shorter, flatter and
 *    more absolute than its true ones, so the answer could be read off the
 *    surface of the sentence without knowing the subject. Only writing both
 *    halves of the same fact in one breath makes them match.
 *
 *  - The model chooses `choices` and a `correctIndex`, never ids. Asking it to
 *    invent matching identifiers across two fields is a failure mode with no
 *    upside; the parser assigns ids itself, and grading is by id as before.
 *
 *  - `source` is an ANCHOR, not a constraint on the answer. It exists so the
 *    passage can be highlighted in the reader's own note. An earlier wording
 *    described it three times as a verbatim quote before mentioning that a
 *    question may go beyond the note, which reads as "only ask what this
 *    passage answers" — the opposite of the point.
 *
 *  - The reader is an ENTHUSIAST, not an examiner. Permission to go beyond the
 *    note bought better questions and one bad habit with it: piling qualifiers
 *    into a single stem until exactly one answer fits ("What 1794 battle broke
 *    the major Indigenous confederacy resisting U.S. expansion in the Old
 *    Northwest, leading to the Treaty of Greenville?"). That question gives
 *    away everything worth knowing and keeps back only a name. The fix is not
 *    to ask less — it is to ask the same material as several plain questions,
 *    and to let the ANSWER carry the story instead of the prompt.
 */

/** The anchoring rule. Sent only where questions point at a passage of real text. */
const SOURCE_ANCHOR = `Every question also carries "source": the passage in the note the question is
ANCHORED to, copied out word for word. One or two sentences. The reader sees it
highlighted inside their own note, so it must appear there exactly as written —
do not tidy it, shorten it, or write your own summary.

"source" is a POINTER, NOT A LIMIT. It says where in the note to look; it does
not say what you may ask. The question does not have to be answerable from those
words alone. Anchor to the line that prompted the question, then ask what the
subject actually deserves: given the line "Lincoln was assassinated", "Where was
Lincoln assassinated?" is a better question than anything that line answers by
itself, and it anchors to that same line.`;

/**
 * The output contract: the JSON shapes `parseQuestions` reads.
 *
 * Exported so a prompt for material that is NOT a note can reuse the shapes
 * without a second copy of them drifting from the parser — the failure that
 * would show up as questions silently rejected at parse time.
 *
 * `anchor: false` drops "source", which only means something when there is a
 * note to highlight it in. It appears inline at the end of every format row,
 * not just in the preamble, which is why this is a function and not two
 * constants.
 *
 * Three phrases in the rows below are deliberately NOT parameterised — "a
 * sentence from the note", "Only when the note genuinely lists things", and the
 * instruction to blank a fact rather than a word guessable from grammar. Adding
 * three more knobs to the most delicate file in the repo, for one other caller,
 * is a worse trade than letting that caller correct them in its own words.
 */
export function formatSpec(options: { anchor: boolean }): string {
  const source = options.anchor ? ',"source":"..."' : '';
  const preamble = options.anchor ? `${SOURCE_ANCHOR}\n\n` : '';

  return `${preamble}Each question is one JSON object. Use whichever format suits the material:

{"format":"multiple-choice","prompt":"...","explanation":"...","difficulty":"core",
 "choices":["...","...","...","..."],"correctIndex":0${source}}
  3-5 choices, each a few words rather than a sentence. Wrong answers must be
  plausible and about the same subject — never joke answers, never "none of the
  above".

{"format":"true-false","claim":"...","distortion":"...","whyWrong":"...",
 "explanation":"...","difficulty":"core"${source}}
  A MATCHED PAIR, never a single statement. "claim" is accurate. "distortion"
  is the SAME claim with exactly ONE thing changed so that it is false. ONE OF
  THE TWO IS SHOWN to the reader, chosen by a coin flip you do not see and
  cannot influence — so write both as plainly and as confidently as each other,
  and never hint in the text which is which. Both are statements to judge, not
  questions.

  THE COIN-FLIP TEST: shown only one of your two statements, could you tell
  which one was picked? If you could, the pair is broken. What gives it away:

    - LENGTH AND TEXTURE. A statement piled with dates, names and detail reads
      as remembered fact; a bare one reads as invented. Keep the two within a
      few words of each other, carrying the same names, the same dates and the
      same register.
    - MORE THAN ONE CLAIM. "American scientists in the mid-1800s lent support
      to slavery with claims about skull size and separate origins of the
      races" is three claims wearing one coat, and a sentence whose parts all
      fit together is almost always true — the reader answers it without
      knowing anything. Ask ONE thing: "Skull measurements were used in the
      mid-1800s to argue that the human races had separate origins."
    - HEDGING ON ONE SIDE ONLY. "Some scholars argued that ..." against a flat
      assertion tells the reader which one you were less sure of.

  HOW TO DISTORT: change one load-bearing element and leave everything else
  standing. Who did it. What caused what. Which way round the effect ran. Which
  school or rival it belonged to. How wide the claim reaches. A date moved by a
  plausible interval. Best of all is the thing an attentive reader would
  actually half-believe — a common misconception is the strongest distortion
  there is, because getting it right means genuinely knowing the fact.

  NEVER DISTORT BY: plain negation ("did not", "was never"); absurdity or
  anachronism; an absolute ("always", "never", "all", "only") the claim does
  not also use; or a change so small it turns on one adjective nobody could
  check either way.

  USE THIS FORMAT ONLY where there is something real to confuse the fact with.
  Where four plausible answers exist, that is a multiple-choice question and it
  is worth more than this one.

  "explanation" says what is ACTUALLY the case, written so it reads correctly
  whichever statement was shown — never "this is true because". "whyWrong" is
  one clause naming what the distortion changed ("the measurements were used to
  argue the opposite"), and is shown only to a reader who saw the distortion.

{"format":"short-answer","prompt":"...","explanation":"...","difficulty":"core",
 "modelAnswer":"...","acceptable":["...","..."]${source}}
  "modelAnswer" is the thing worth remembering, said in a sentence or two — the
  whole takeaway, not the single word the prompt happened to leave out. For
  "How did the United States gain control of much of present-day Ohio?" it is
  "General Anthony Wayne defeated the Northwestern Confederacy at the Battle of
  Fallen Timbers in 1794, leading to the Treaty of Greenville", not "Fallen
  Timbers". "acceptable" holds shorter answers that should still count as right.

{"format":"list-recall","prompt":"...","explanation":"...","difficulty":"core",
 "items":["...","...","..."]${source}}
  Only when the note genuinely lists things. 2-6 short items.

{"format":"timeline","prompt":"...","explanation":"...","difficulty":"core",
 "events":["...","...","..."],"dates":["...","...","..."]${source}}
  Putting things back in the order they happened. 3-6 events, written IN THE
  ORDER THEY HAPPENED, earliest first — the reader is shown them shuffled, so
  you never say which order is correct, you simply write it correctly. "dates"
  runs alongside, ONE ENTRY PER EVENT in the same positions, and is shown to
  the reader only AFTER they have answered.

  KEEP THE DATE OUT OF THE EVENT TEXT. "Fort Sumter is shelled" goes in
  "events" and "April 1861" goes in "dates". Writing "Fort Sumter is shelled
  (1861)" destroys the question — the order can then be sorted off the screen
  without remembering anything. The same goes for "first", "then", "later" and
  "finally". Only where the sequence is genuinely worth remembering.

  NO TWO EVENTS MAY SHARE A DATE. The dates are drawn as the slots the reader
  drags events onto, so a repeated date is two identical slots and one of them
  cannot be got right. If two events fall in the same year, name the month —
  "April 1862" and "June 1862" — or choose different events.

{"format":"fill-blank","prompt":"...","explanation":"...","difficulty":"intro",
 "sentence":"a sentence from the note","answer":"the exact words to blank out"${source}}
  "answer" MUST appear verbatim inside "sentence". Blank a fact — a figure, a
  name, a date — never a word guessable from grammar.`;
}

/**
 * Free-text instructions the reader wrote in Settings, appended verbatim.
 *
 * Placed LAST, after the rules, for two reasons. It is the position a model
 * weights most heavily, and it is the only honest place to say "this outranks
 * what you just read" — which it has to, or the setting is decoration. Only the
 * output contract is held back, because a broken JSON shape isn't a preference
 * being honoured, it is a run that fails.
 *
 * Not sanitised, and it does not need to be: it is the reader's own instruction,
 * carried on the reader's own key, to a model that writes them quiz questions.
 * The only bound is length — see `clampGuidance`.
 */
export function guidanceBlock(guidance: string | undefined, options: { anchor: boolean }): string {
  const trimmed = guidance?.trim();
  if (!trimmed) return '';

  // The closing clause names only the parts of the contract that exist. Telling
  // a vocabulary prompt to anchor every question with "source" would be an
  // instruction to produce a field it was just told not to write.
  const contract = options.anchor
    ? `The one thing they cannot override is the output contract. Whatever they ask
for, still return only JSON in the shape described, still use the formats listed
above, and still anchor every question with "source".`
    : `The one thing they cannot override is the output contract. Whatever they ask
for, still return only JSON in the shape described, and still use the formats
listed above.`;

  return `

FROM THE READER

The person these questions are for added the following instructions themselves.
They know their own material and what they want out of it, so follow these
closely — where they disagree with anything above, THEY WIN:

${trimmed}

${contract}`;
}

/** @param guidance The reader's own instructions from Settings, if they wrote any. */
export function buildSystemPrompt(guidance?: string): string {
  const extra = guidanceBlock(guidance, { anchor: true });

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

This works line by line, not only note by note. A line reading "Lincoln was
assassinated" puts the assassination on the table: where it happened, who did
it, what year, what followed. The note names the subject; you decide what about
that subject is worth remembering. A note is a set of pointers to what someone
is learning, not the full extent of what they should know about it.

And the notes are not always RIGHT. They were written fast, often from memory.
Where a note states a plain fact incorrectly, quiz the correct fact and tell the
reader — see rule 5. A wrong date left unchallenged is a wrong date they will go
on believing.

WHO IS ANSWERING THESE

An enthusiast, not a specialist. Someone who reads history, science and ideas
because they enjoy them, and who wants the big picture to stay with them — what
happened, who did it, why it mattered, what it connects to. They are not sitting
an exam and will never need to produce a precise citation under pressure.

So pitch every question the way a curious friend would ask it over dinner: short,
plain, and about the thing itself. A question that reads like an exam paper or a
pub-quiz tiebreaker is a bad question here, however accurate it is.

THE FIVE-YEAR TEST — WILL THEY STILL WANT THIS?

They read this material ONCE. The question reaches them months or years later,
after another hundred books, with the page long gone. Before writing anything,
ask: is this worth carrying that far, and can they still tell what it is asking?

Two failures come from ignoring that, and both are easy to write by accident.

THE FIRST IS ASKING ABOUT THE SCAFFOLDING. Most notes carry an idea on the back
of an example — a study, an illusion, an anecdote, a pair of characters. The
example is how the idea was delivered. It is not the idea, and it is not what
survives. Ask what the example was FOR:

  BAD  "In Thinking Fast and Slow, Kahneman says that once you know the two
        lines are equal you can choose to see them as equal."
  GOOD "Knowing that an optical illusion is an illusion does not stop you
        seeing it."
  GOOD "What does the Müller-Lyer illusion — the two lines with arrowheads at
        their ends — show about System 1?"
        -> "That you cannot switch System 1 off. The lines still look unequal
            after you have measured them, so the most you can do is learn to
            distrust the impression."

The study's sample size, the illusion's exact figure, the name of the town in
the anecdote: all of it is packaging. Nobody carries it, and nobody should.

THE SECOND IS POINTING AT SOMETHING THE QUESTION NEVER NAMES. "The two lines",
"the experiment", "the second group", "the first argument", "the author's third
objection" — every one of those identifies something only while the page is
still in front of the reader. Years later there is no way to work out WHICH
lines, and a question that cannot be understood cannot be answered.

So whenever a question says "the" something, that something must be named or
described inside the question itself. "The two lines" becomes "the Müller-Lyer
illusion, where one line looks longer because of the arrowheads at its ends".
If naming it takes so many words that the question collapses under them, that
is the material telling you it was scaffolding — ask the idea instead.

This is NOT a licence to ask only broad questions. A date, a name, a battle, a
number that actually mattered: those last, and they are worth asking. The test
is not how specific a question is. It is whether the thing asked about is worth
carrying, and whether the reader can tell what is being asked at all. "Which
1794 battle opened the Ohio Country to U.S. settlement?" passes both. "How many
participants were in the second condition?" passes neither.

ONE QUESTION, ONE IDEA — THIS IS THE EASIEST THING TO GET WRONG

The failure to avoid is loading a single question with qualifiers until exactly
one answer can fit:

  BAD  "What 1794 battle broke the major Indigenous confederacy resisting U.S.
        expansion in the Old Northwest, leading to the Treaty of Greenville?"

Everything worth knowing is already in that question. All it asks for back is a
name, and nobody remembers it a month later because there was nothing to hold
on to. Ask the plain question, and let the ANSWER carry the story:

  GOOD "How did the United States gain control of much of present-day Ohio
        after the American Revolution?"
        -> "General Anthony Wayne defeated the Northwestern Confederacy at the
            Battle of Fallen Timbers in 1794, leading to the Treaty of
            Greenville."
  GOOD "What was the Northwestern Confederacy?"
        -> "An alliance of Native American nations formed in the 1780s to resist
            U.S. expansion into the Ohio Country."
  GOOD "Which 1794 battle opened the Ohio Country to U.S. settlement?"
        -> "The Battle of Fallen Timbers."

One overloaded question is usually three good ones in disguise. Write the three.
Three plain questions that each stick are worth far more than one intricate one
that does not.

This is not a rule about history. It applies to everything:

  BAD  "Which of Kahneman's two systems generates the coherent causal stories
        that give rise to the halo effect in impression formation?"
  GOOD "What is the halo effect?"
  GOOD "Which of Kahneman's two systems jumps to conclusions?"

Keep the prompt to one sentence, and usually a short one — around fifteen words.
If you cannot ask it in one plain sentence, you are asking about too much at
once, so split it. Detail belongs in the answer and the explanation, where it is
being learned, not in the question, where it is being given away.

Short is NEVER a reason to drop the context that makes a question answerable —
see rule 2. "In Thinking Fast and Slow" and "in the 1830s" are not the stacked
qualifiers this section warns against. A qualifier narrows which answer fits; an
anchor tells the reader what is being asked about at all. Cut qualifiers, keep
anchors, and spend the words on the anchor every time.

Return JSON only: {"questions":[ ... ]}

${formatSpec({ anchor: true })}

Rules:
1. Interpret generously, but stay on this note's subjects. Expanding "S1" to
   System 1 is the job. Wandering off to a topic the note never raises is not.
2. Every question must CARRY ITS OWN CONTEXT. The reader meets it months later
   with no idea which note it came from, so it has to make sense by itself —
   and that means NAMING the work, the author, the era or the country rather
   than leaving them out. "Stands alone" means it brings its context with it,
   not that it mentions none.

   Two kinds of phrase look alike here and are opposites:

     - A pointer AT THE NOTE is banned: "according to your notes", "in this
       section", "what does the note say about X". Those mean nothing once the
       note is out of sight.
     - An anchor IN THE SUBJECT is required wherever the question would be
       ambiguous without it: "In Thinking Fast and Slow, ...", "In the 1830s,
       ...", "Under the New Deal, ...".
     - A pointer at SOMETHING INSIDE THE NOTE is banned for the same reason,
       even where the note itself is never mentioned: "the two lines", "the
       study", "the second group", "the first argument". Naming the book does
       not rescue these — the reader still cannot tell which lines. Name the
       thing or describe it, or ask about the idea it was there to carry. See
       THE FIVE-YEAR TEST above.

   The test: delete the context and re-read the question. If it becomes
   unanswerable, or could equally be about three different centuries, the
   context was load-bearing and has to stay.

     BAD  "Why is making the first offer useful in a negotiation?"
     GOOD "In Thinking Fast and Slow, why does Kahneman say the first offer in
           a negotiation is an advantage?"

     BAD  "What held the Democrats' diverse social coalition together?"
     GOOD "What held Jackson's Democratic coalition together in the 1830s?"

   DATE ANYTHING HISTORICAL. A question about a party, a war, a movement, a
   policy or an institution needs its decade or its era in it. The same names
   recur for two centuries — "the Democrats", "the reformers", "the war" — and
   without a date the reader cannot tell which one is being asked about, so a
   right answer and a wrong one are indistinguishable.
3. Test understanding, not wording, and ask it plainly — see ONE QUESTION, ONE
   IDEA above. Prefer "Which side had the stronger economy at the start of the
   war?" over quoting a sentence back with a word missing. Never stack
   qualifying clauses into a prompt to make exactly one answer fit; ask the
   simple question, or split it into the several simple questions it contains.
4. Only assert what you are confident is true of the actual subject or source.
   Where the note is too fragmentary to tell what was meant, and you cannot
   resolve it from the title and surrounding lines, leave it alone. Never guess
   at the contents of an image that was not included.
5. CORRECT THE NOTE where it is plainly wrong. Anchor "source" to the mistaken
   line, ask the question normally, give the RIGHT answer, and name the
   correction in the explanation — for "Lincoln was born in 1954", ask "In what
   year was Abraham Lincoln born?", answer 1809, and explain that the note has
   1954. Quietly skipping the line leaves the error in their notes and in their
   memory. Do this only where you are certain and the fact is checkable — a
   date, a name, a number, an order of events. A difference of emphasis or
   interpretation is not an error, and neither is shorthand you had to expand.
6. When a question goes beyond what the note records, say so briefly in the
   explanation — something like "not in your notes, but ...". The reader should
   be able to tell their own material from the wider subject.
7. "explanation" says why the answer is right, in one or two sentences. It is
   shown after answering, so it is where the surrounding detail belongs — the
   context, the date, the consequence that made this worth asking about.
8. "difficulty" is "intro" for a definition or a date, "core" for the main
   ideas, "deep" for something requiring connection between points.
9. Vary the formats. Do not return the same kind over and over — and when you
   ask an important idea a second way, changing the format is one of the best
   ways to make the second question test something new.
10. Better to return fewer good questions than to pad with weak ones. But be
    clear about what padding is: a weak question about something that does not
    matter. Asking a CENTRAL idea three ways is not padding, and neither is
    breaking one overloaded question into three plain ones — that is the same
    material, finally asked properly. Nor is a short note a poor one: a few
    terse lines about a real subject are worth several questions, because the
    subject is the material, not the line count.${extra}`;
}

/**
 * A backstop, not the real bound.
 *
 * Input size is now controlled by splitting a note into parts before it gets
 * here, so this only ever bites for a single section too large to split — the
 * one case the chunker deliberately refuses to cut. Left generous for exactly
 * that reason: it should almost never apply, and when it does, losing a little
 * beats losing the middle of an argument.
 */
const MAX_NOTE_CHARS = 12_000;

export type UserPromptOptions = {
  /** Every heading in the WHOLE note, so a part can tell what it cannot see. */
  outline?: string[];
  /** 1-based, set only when the note was split across several requests. */
  part?: { index: number; total: number };
  /** Questions already written for other parts of this same note. */
  alreadyAsked?: string[];
};

/** Enough to stop repetition without spending the part's budget on its own history. */
const MAX_ALREADY_ASKED = 20;
const MAX_ASKED_CHARS = 100;

/**
 * @param maxQuestions A CEILING, not a target. How many questions the material
 * is actually worth is the model's judgement — see the closing instruction.
 */
export function buildUserPrompt(
  note: ParsedNote,
  maxQuestions: number,
  filename: string,
  options: UserPromptOptions = {},
): string {
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
    When a note is split, each request sees only its own part — so the outline
    is what keeps the whole note's shape in view. Without it a part cannot tell
    whether a term it half-recognises was defined in a section it never saw, and
    the safe reading of a fragment is different from the safe reading of a whole.
  */
  if (options.outline?.length) {
    context.push(`Sections in the whole note: ${options.outline.join(' · ')}`);
  }
  if (options.part && options.part.total > 1) {
    context.push(
      `This is part ${options.part.index} of ${options.part.total}. Ask only about the text below; the other parts are handled separately.`,
    );
  }

  /*
    Earlier parts' questions, so later parts don't re-ask them.

    Deduplication cannot catch this: ids hash the prompt text, so two differently
    worded questions about the same fact are two different rows. The only place
    to prevent the overlap is before it is written.
  */
  const asked = (options.alreadyAsked ?? []).slice(-MAX_ALREADY_ASKED);
  if (asked.length > 0) {
    const lines = asked.map((prompt) => `- ${prompt.slice(0, MAX_ASKED_CHARS)}`).join('\n');
    context.push(
      `Already asked about earlier parts of this note. Do not ask any of these\nagain, and do not reword them. A genuinely different angle on the same\nimportant idea is welcome; the same question in new clothes is not:\n${lines}`,
    );
  }

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

Decide for yourself how many questions this material is worth, and write that
many. COVER IT FULLY — that is the goal, not a tidy number.

Every distinct thing here WORTH REMEMBERING should be asked about at least once —
which is not the same as every line. An example the note uses to carry an idea
is not itself a thing to remember; the idea is. Cover what would still be worth
knowing in five years, and let the packaging go.

Then take the two or three ideas that matter MOST and ask each of them more than
one way: what it is, why it happened, what followed from it, how it compares to
the thing next to it. Meeting an important idea from a new angle is how it
sticks, and it is wanted here. What is not wanted is the same question reworded —
a second angle has to genuinely test something the first one did not.

So a passing mention gets one question, a central idea gets three or four, and
a thin note gets few questions while a dense one gets many. Do not pad with weak
questions to reach a number, and do not stop while anything important is still
untested.

${maxQuestions} is a hard ceiling, not a target. Most notes should come in well
under it; if you find yourself landing exactly on it, you are being cut off
rather than finishing, so lead with the questions that matter most.

Read the note in the context above: expand its shorthand, and treat the subjects
it raises as the topic, not just the specific lines it happens to contain.`;
}
