import { ANCHORING, CIVIL_WAR } from '../../notes/__fixtures__/sampleNotes';
import { parseNote } from '../../notes/parse';
import { noteFilename, noteStem } from '../../notes/paths';
import { buildSystemPrompt, buildUserPrompt, formatSpec, guidanceBlock } from './prompt';

function promptFor(fixture: { path: string; content: string }, count = 5): string {
  return buildUserPrompt(
    parseNote(fixture.content, noteStem(fixture.path)),
    count,
    noteFilename(fixture.path),
  );
}

describe('buildUserPrompt — context', () => {
  const prompt = promptFor(ANCHORING);

  it('gives the filename verbatim, which is what decodes the shorthand', () => {
    /*
      The whole point. "Priming happens in S1" is meaningless alone and obvious
      once the model knows the note belongs to Thinking Fast and Slow. The
      hand-written filename already says so, extension and all, so it goes in
      as-is rather than being split into parts that can each go missing.
    */
    expect(prompt).toContain('File: Thinking Fast and Slow 11 Anchoring.md');
  });

  it('never substitutes a derived series or title for the filename', () => {
    expect(prompt).not.toContain('Series:');
    expect(prompt).not.toContain('Title:');
  });

  it('keeps the extension, rather than tidying it away', () => {
    expect(prompt).toContain('Anchoring.md');
  });

  it('passes through the vault’s own tags', () => {
    expect(prompt).toContain('Tags: psychology, cognitive-bias, stats');
  });

  it('passes through wiki-links, which mark what the writer connected this to', () => {
    expect(prompt).toContain('Links to: Priming');
  });

  it('omits the tag and link lines when the note has none', () => {
    const prompt = promptFor(CIVIL_WAR);
    expect(prompt).not.toContain('Tags:');
    expect(prompt).not.toContain('Links to:');
  });

  it('passes an unnumbered filename through unchanged', () => {
    // Nothing to parse here, and nothing that needs parsing — the name is the
    // name whether or not it fits a series-and-index shape.
    const note = parseNote('Some content here that is long enough.', 'Britain in the 70s');
    const prompt = buildUserPrompt(note, 3, 'Britain in the 70s.md');
    expect(prompt).toContain('File: Britain in the 70s.md');
  });

  it('states the limit as a ceiling and leaves the number to the model', () => {
    /*
      The whole point of the change this replaced. A fixed "write N questions"
      is a quota: it pads a thin note and truncates a rich one. How much a note
      is worth is a judgement about the material, which only the reader of that
      material can make.
    */
    const prompt = promptFor(ANCHORING, 10);
    expect(prompt).toContain('Decide for yourself how many questions');
    expect(prompt).toContain('hard ceiling, not a target');
    expect(prompt).toContain('10');
    expect(prompt).not.toContain('Write up to');
  });

  it('names landing exactly on the ceiling as a symptom, not a job done', () => {
    /*
      The observed behaviour: note after note came back with EXACTLY the ceiling
      number of questions. A limit that is hit every time is a quota, and the
      model had no way to tell that was the wrong outcome. Now it does.
    */
    const prompt = promptFor(ANCHORING, 20);
    expect(prompt).toMatch(/Most notes should come in well\s+under it/);
    expect(prompt).toMatch(/landing exactly on it, you are being cut off/);
  });

  it('asks for full coverage rather than one question per idea', () => {
    // The old wording — "one for each distinct thing worth remembering, no more,
    // no less" — forbade exactly the repeated angles that make an idea stick.
    const prompt = promptFor(ANCHORING);
    expect(prompt).toContain('COVER IT FULLY');
    expect(prompt).not.toContain('no more, no less');
  });

  it('says full coverage is of what is worth remembering, not of every line', () => {
    // "COVER IT FULLY" alone reads as a sweep of the note, which is how an
    // example's props end up quizzed alongside the point they were carrying.
    const prompt = promptFor(ANCHORING);
    expect(prompt).toMatch(/which is not the same as every line/);
    expect(prompt).toMatch(/is not itself a thing to remember; the idea is/);
    expect(prompt).toMatch(/still be worth\s+knowing in five years/);
  });

  it('asks the most important ideas more than one way', () => {
    const prompt = promptFor(ANCHORING);
    expect(prompt).toMatch(/ask each of them more than\s+one way/);
    expect(prompt).toMatch(/from a new angle is how it\s+sticks/);
  });

  it('still refuses a reworded duplicate, which is not a second angle', () => {
    // Without this the instruction above reads as licence to pad, which is the
    // failure mode it would be easiest to trade into.
    const prompt = promptFor(ANCHORING);
    expect(prompt).toMatch(/not wanted is the same question reworded/);
    expect(prompt).toMatch(/genuinely test something the first one did not/);
  });

  it('scales the count to how central the idea is', () => {
    const prompt = promptFor(ANCHORING);
    expect(prompt).toMatch(/a passing mention gets one question, a central idea gets three or four/);
  });
});

describe('buildUserPrompt — a note split across several requests', () => {
  const note = parseNote(ANCHORING.content, noteStem(ANCHORING.path));
  const filename = noteFilename(ANCHORING.path);

  it('sends nothing extra when the note was not split', () => {
    // The common case. Keeping it byte-identical to the unsplit prompt means the
    // overwhelming majority of notes are unaffected by chunking existing at all.
    const prompt = buildUserPrompt(note, 10, filename);
    expect(prompt).not.toContain('Sections in the whole note');
    expect(prompt).not.toContain('This is part');
    expect(prompt).not.toContain('Already asked');
  });

  it('names every section of the whole note, not just the part being sent', () => {
    const prompt = buildUserPrompt(note, 10, filename, {
      outline: ['Anchoring', 'Two Mechanisms', 'Anchoring Index'],
      part: { index: 2, total: 3 },
    });
    expect(prompt).toContain('Sections in the whole note: Anchoring · Two Mechanisms · Anchoring Index');
    expect(prompt).toContain('This is part 2 of 3');
  });

  it('omits the part marker when there is only one part', () => {
    const prompt = buildUserPrompt(note, 10, filename, { part: { index: 1, total: 1 } });
    expect(prompt).not.toContain('This is part');
  });

  it('lists what earlier parts already asked, so they are not re-asked', () => {
    /*
      Deduplication cannot catch this — ids hash the prompt text, so two
      differently worded questions about one fact are two different rows.
    */
    const prompt = buildUserPrompt(note, 10, filename, {
      alreadyAsked: ['What is the anchoring index?', 'Which system does priming act in?'],
    });
    expect(prompt).toContain('Do not ask any of these');
    expect(prompt).toContain('- What is the anchoring index?');
  });

  it('still lets a later part come at the same idea from a new angle', () => {
    /*
      A blanket "do not repeat these" was too blunt once important ideas are
      meant to be asked several ways: the parts of a long note are exactly where
      a central idea recurs, and the instruction was forbidding the second angle
      along with the duplicate.
    */
    const prompt = buildUserPrompt(note, 10, filename, {
      alreadyAsked: ['What is the anchoring index?'],
    });
    expect(prompt).toMatch(/genuinely different angle on the same\s+important idea is welcome/);
    expect(prompt).toMatch(/do not reword them/);
  });

  it('caps the already-asked list rather than resending a whole note of history', () => {
    const many = Array.from({ length: 60 }, (_, index) => `Question number ${index}?`);
    const prompt = buildUserPrompt(note, 10, filename, { alreadyAsked: many });
    expect(prompt).toContain('Question number 59?');
    expect(prompt).not.toContain('Question number 5?');
  });

  it('still gives the filename verbatim in every part', () => {
    const prompt = buildUserPrompt(note, 10, filename, { part: { index: 3, total: 4 } });
    expect(prompt).toContain('File: Thinking Fast and Slow 11 Anchoring.md');
  });
});

describe('buildUserPrompt — the note body', () => {
  it('includes the note text with its headings', () => {
    const prompt = promptFor(ANCHORING);
    expect(prompt).toContain('## Two Mechanisms');
    expect(prompt).toContain('Adjustment, which is a deliberate System 2 operation');
  });

  it('delimits the note so context cannot be mistaken for content', () => {
    const prompt = promptFor(ANCHORING);
    expect(prompt).toContain('--- the note, as written ---');
    expect(prompt).toContain('--- end of note ---');
  });

  it('sends prose, not raw markdown', () => {
    const prompt = promptFor(CIVIL_WAR);
    expect(prompt).not.toContain('![[');
  });

  it('tells the model how many images it could not read', () => {
    // A note that is half screenshots reads as disjointed; saying so is what
    // stops the model inventing connective tissue to explain the gaps.
    expect(promptFor(CIVIL_WAR)).toContain('6 images in this note could not be read');
  });

  it('says nothing about images when there were none', () => {
    expect(promptFor(ANCHORING)).not.toContain('could not be read');
  });
});

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt();

  it('tells the model the notes are terse personal shorthand', () => {
    expect(prompt).toMatch(/PERSONAL NOTES/);
    expect(prompt).toMatch(/between the lines/i);
  });

  it('asks every format for the passage the question came from', () => {
    // The highlight depends on it, so it has to be on each example rather than
    // mentioned once and hoped for.
    expect(prompt).toMatch(/"source"/);
    expect(prompt).toMatch(/word for word/i);
    for (const format of ['multiple-choice', 'true-false', 'short-answer', 'list-recall', 'fill-blank', 'timeline']) {
      const example = prompt.slice(prompt.indexOf(`"format":"${format}"`));
      const nextBrace = example.indexOf('}');
      expect(example.slice(0, nextBrace)).toContain('"source"');
    }
  });

  it('says plainly that the source is an anchor, not a limit on the question', () => {
    /*
      The failure mode this guards. Asking for a verbatim passage per question
      reads as "only ask what this passage answers", which turns a note full of
      pointers into a note full of nothing worth asking. The anchoring line and
      the question are two different things and the prompt has to say so.
    */
    expect(prompt).toMatch(/POINTER, NOT A LIMIT/);
    expect(prompt).toMatch(/does not have to be answerable from those\s+words alone/);
  });

  it('gives a worked example of asking past the line it anchors to', () => {
    // Abstract permission is ignored; a concrete example is followed.
    const spec = prompt.slice(prompt.indexOf('POINTER'), prompt.indexOf('Each question is one JSON'));
    expect(spec).toContain('Lincoln was assassinated');
    // Wrapped across a line in the prompt, so matched on words not on layout.
    expect(spec).toMatch(/Where was\s+Lincoln assassinated\?/);
  });

  it('tells the model the note itself may be wrong, and to correct it', () => {
    expect(prompt).toMatch(/CORRECT THE NOTE/);
    // The worked example, so "correct it" has a shape rather than being a hope.
    expect(prompt).toContain('1954');
    expect(prompt).toContain('1809');
    expect(prompt).toMatch(/name the\s+correction in the explanation/);
  });

  it('bounds correcting to checkable facts, not to disagreement', () => {
    // Otherwise it rewrites the writer's reading of their own material.
    expect(prompt).toMatch(/only where you are certain/i);
    expect(prompt).toMatch(/difference of emphasis or\s+interpretation is not an error/);
  });

  it('says a short note is not a poor one', () => {
    // Paired with "better fewer than padded", which alone reads as permission
    // to return nothing for a terse note about a real subject.
    expect(prompt).toMatch(/Nor is a short note a poor one/);
  });

  it('defines padding, so "fewer good questions" cannot smother coverage', () => {
    // Rule 10 pulls against asking a central idea several ways unless it says
    // which of the two it means.
    expect(prompt).toMatch(/a weak question about something that does not\s+matter/);
    expect(prompt).toMatch(/Asking a CENTRAL idea three ways is not padding/);
  });

  it('extends the free rein to individual lines, not just to the note', () => {
    expect(prompt).toMatch(/line by line/);
  });

  it('gives the S1 example, which is the behaviour being asked for', () => {
    expect(prompt).toContain('System 1');
  });

  it('permits going beyond the note, but requires saying so', () => {
    expect(prompt).toMatch(/does not spell them out/);
    expect(prompt).toMatch(/not in your notes/i);
  });

  it('still forbids questions that only make sense next to the note', () => {
    // The mock's failure mode: "what do your notes say about X" tests whether
    // you remember reading a heading.
    expect(prompt).toContain('according to your notes');
    expect(prompt).toMatch(/CARRY ITS OWN CONTEXT/);
  });

  it('says outright that standing alone is not the same as omitting context', () => {
    /*
      The misreading that produced the bug. Told only "questions must stand
      alone", the model stripped every anchor — "Why is making the first offer
      useful in a negotiation?" with no mention of Kahneman, and a question
      about the Democrats with no century on it. Standing alone means carrying
      your context, not referring to nothing.
    */
    expect(prompt).toMatch(/means it brings its context with it,\s+not that it mentions none/);
  });

  it('separates a pointer at the note from an anchor in the subject', () => {
    // These look alike — both are prepositional phrases before the question —
    // and one is banned while the other is required.
    expect(prompt).toMatch(/A pointer AT THE NOTE is banned/);
    expect(prompt).toMatch(/An anchor IN THE SUBJECT is required/);
    expect(prompt).toContain('In Thinking Fast and Slow');
  });

  it('bans pointing at something the note left unnamed', () => {
    /*
      The gap the two bullets above left open. "In Thinking Fast and Slow,
      Kahneman says that once you know the two lines are equal ..." names its
      book, its author and its idea, passes both of those bullets, and is still
      unanswerable a year later — the lines were on a page the reader will never
      see again. Naming the work is not the same as naming the thing.
    */
    expect(prompt).toMatch(/A pointer at SOMETHING INSIDE THE NOTE is banned/);
    expect(prompt).toMatch(/Naming the book does\s+not rescue these/);
  });

  it('gives a test for whether context is load-bearing', () => {
    // A rule with no test attached gets applied by vibe.
    expect(prompt).toMatch(/delete the context and re-read the question/);
    expect(prompt).toMatch(/three different centuries/);
  });

  it('shows both real failures with their repairs', () => {
    expect(prompt).toContain('Why is making the first offer useful in a negotiation?');
    expect(prompt).toContain("What held the Democrats' diverse social coalition together?");
    expect(prompt).toMatch(/why does Kahneman say the first offer in/);
    expect(prompt).toMatch(/Jackson's Democratic coalition together in the 1830s/);
  });

  it('requires a date on anything historical', () => {
    expect(prompt).toMatch(/DATE ANYTHING HISTORICAL/);
    expect(prompt).toMatch(/needs its decade or its era in it/);
  });

  it('does not let the brevity rule cannibalise the anchor', () => {
    /*
      These two pull against each other: "around fifteen words" and "never stack
      qualifiers" would both, read alone, justify deleting "In the 1830s". The
      prompt has to say which wins, or the fix for one bug reintroduces the other.
    */
    expect(prompt).toMatch(/Short is NEVER a reason to drop the context/);
    expect(prompt).toMatch(/Cut qualifiers, keep\s+anchors/);
  });

  it('still refuses to guess at unreadable images', () => {
    expect(prompt).toMatch(/image that was not included/);
  });

  it('documents every question format the registry knows about', () => {
    for (const format of ['multiple-choice', 'true-false', 'short-answer', 'list-recall', 'fill-blank', 'timeline']) {
      expect(prompt).toContain(`"format":"${format}"`);
    }
  });
});

describe('buildSystemPrompt — how a question is pitched', () => {
  const prompt = buildSystemPrompt();

  it('names the reader as an enthusiast rather than an examiner', () => {
    // The permission to go beyond the note is what produced exam-paper stems;
    // saying who is actually answering is what keeps that permission useful.
    expect(prompt).toMatch(/enthusiast, not a specialist/i);
    expect(prompt).toMatch(/not sitting\s*\n?an exam/i);
  });

  it('forbids stacking qualifiers to make one answer fit', () => {
    /*
      The observed failure, verbatim from a real generated question: a single
      stem carrying the year, the region, the treaty and the outcome, leaving
      only a name to recall. Everything worth remembering was in the question.
    */
    expect(prompt).toContain('ONE QUESTION, ONE IDEA');
    expect(prompt).toMatch(/qualifiers until exactly\s+one answer can fit/);
    expect(prompt).toMatch(/Never stack\s+qualifying clauses/);
  });

  it('shows the bad question and the plain ones that replace it', () => {
    // Abstract instruction is ignored; the worked pair is what gets followed.
    expect(prompt).toContain('What 1794 battle broke the major Indigenous confederacy');
    expect(prompt).toContain('How did the United States gain control of much of present-day Ohio');
    expect(prompt).toContain('What was the Northwestern Confederacy?');
  });

  it('says the answer carries the story, not the prompt', () => {
    expect(prompt).toMatch(/let the ANSWER carry the story/);
    expect(prompt).toMatch(/Detail belongs in the answer and the explanation/);
  });

  it('generalises past history, which is only one of the subjects', () => {
    // A rule taught with one history example gets applied to history alone.
    expect(prompt).toMatch(/not a rule about history/i);
    expect(prompt).toContain('What is the halo effect?');
  });

  it('gives a concrete length to aim at rather than just "short"', () => {
    expect(prompt).toMatch(/around fifteen words/);
  });

  it('asks for the whole takeaway as the model answer, not the missing word', () => {
    expect(prompt).toMatch(/the thing worth remembering, said in a sentence or two/);
    // Wrapped across a line in the prompt, so matched on words not on layout.
    expect(prompt).toMatch(/not "Fallen\s+Timbers"/);
  });

  it('does not let splitting read as padding, which rule 10 forbids', () => {
    // These two instructions pull against each other unless reconciled in the
    // text: "return fewer questions" vs "ask three where you asked one".
    expect(prompt).toMatch(/neither is\s+breaking one overloaded question into three plain ones/);
  });
});

/*
  The second class of unanswerable question, after the missing anchor. This one
  arrived fully anchored: "In Thinking Fast and Slow, Kahneman says that once
  you know the two lines are equal you can choose to see them as equal." It
  names the book and the author, and a reader a year later still has no idea
  which lines — the illusion was a page they will never see again, and the point
  it was carrying (System 1 cannot be switched off) was never asked at all.
*/
describe('buildSystemPrompt — what survives the book', () => {
  const prompt = buildSystemPrompt();

  it('sets the horizon the question has to survive', () => {
    expect(prompt).toContain('THE FIVE-YEAR TEST');
    expect(prompt).toMatch(/They read this material ONCE/);
    expect(prompt).toMatch(/months or years later/);
  });

  it('separates the example from the idea it was carrying', () => {
    expect(prompt).toMatch(/THE FIRST IS ASKING ABOUT THE SCAFFOLDING/);
    expect(prompt).toMatch(/It is not the idea, and it is not what\s+survives/);
  });

  it('keeps the observed failure and its repair as the worked example', () => {
    // Verbatim from a real generated question, with the two ways to ask what it
    // was actually about — the idea alone, or the example named in full.
    expect(prompt).toContain('once you know the two');
    expect(prompt).toContain('Knowing that an optical illusion is an illusion does not stop you');
    expect(prompt).toContain('Müller-Lyer illusion');
    expect(prompt).toMatch(/cannot switch System 1 off/);
  });

  it('names the detail nobody carries', () => {
    expect(prompt).toMatch(/all of it is packaging/);
  });

  it('bans the definite article that points at nothing', () => {
    expect(prompt).toMatch(/THE SECOND IS POINTING AT SOMETHING THE QUESTION NEVER NAMES/);
    expect(prompt).toContain('"the experiment", "the second group"');
    expect(prompt).toMatch(/that something must be named or\s+described inside the question itself/);
  });

  it('says what to do when naming the thing would sink the question', () => {
    // Otherwise the fix for an unnamed reference is a stem stuffed with the
    // description of one, which rule 3 forbids for good reason.
    expect(prompt).toMatch(/ask the idea instead/);
  });

  it('does not let "worth remembering" become permission to ask only vague things', () => {
    /*
      This pulls against the rest of the section, which spends thirty lines
      warning off specifics. Unreconciled, it would take out "Which 1794 battle
      opened the Ohio Country?" — a question the prompt elsewhere holds up as
      one of its best.
    */
    expect(prompt).toMatch(/NOT a licence to ask only broad questions/);
    expect(prompt).toContain('passes both');
    expect(prompt).toContain('passes neither');
  });
});

describe('buildSystemPrompt — the reader’s own instructions', () => {
  it('sends nothing at all when none were written', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain('FROM THE READER');
  });

  it('treats blank and whitespace-only guidance as none', () => {
    // Otherwise an empty heading tells the model to expect instructions that
    // are not there, which is worse than saying nothing.
    expect(buildSystemPrompt('   \n\n  ')).not.toContain('FROM THE READER');
    expect(buildSystemPrompt('')).not.toContain('FROM THE READER');
  });

  it('includes what was written, word for word', () => {
    const prompt = buildSystemPrompt('Skip anything about statistics.\nAsk about people.');
    expect(prompt).toContain('FROM THE READER');
    expect(prompt).toContain('Skip anything about statistics.\nAsk about people.');
  });

  it('puts it last, where it is weighted most and can outrank the rest', () => {
    const prompt = buildSystemPrompt('Ask harder questions.');
    // After the numbered rules, not spliced in among them.
    expect(prompt.indexOf('FROM THE READER')).toBeGreaterThan(prompt.indexOf('never padding'));
    expect(prompt).toMatch(/THEY WIN/);
  });

  it('still holds back the output contract, which is not a preference', () => {
    // "Just give me a list" has to not break every note in the run.
    const prompt = buildSystemPrompt('Reply in plain text, no JSON.');
    expect(prompt).toMatch(/cannot override is the output contract/);
    expect(prompt).toMatch(/still return only JSON/);
  });
});

/*
  The format spec is shared with the vocabulary prompt, which describes a word
  rather than a note. These guard the seam: the note path must still carry the
  whole thing, and the anchorless variant must not ask for a field that only
  means something when there is a note to highlight it in.
*/
describe('formatSpec — shared with prompts that are not about notes', () => {
  it('is what the note prompt documents, rather than a second copy of it', () => {
    expect(buildSystemPrompt()).toContain(formatSpec({ anchor: true }));
  });

  it('drops "source" entirely when there is no note to anchor to', () => {
    expect(formatSpec({ anchor: false })).not.toContain('"source"');
  });

  it('still names every field the parser reads, with or without an anchor', () => {
    // The half that must never drift: these are the keys `parseQuestions` looks
    // for, and a spec missing one produces questions rejected at parse time.
    const spec = formatSpec({ anchor: false });
    for (const field of [
      'correctIndex',
      'sentence',
      'answer',
      'modelAnswer',
      'items',
      'claim',
      'distortion',
      'whyWrong',
      'events',
      'dates',
    ]) {
      expect(spec).toContain(`"${field}"`);
    }
    for (const format of ['multiple-choice', 'true-false', 'short-answer', 'list-recall', 'fill-blank', 'timeline']) {
      expect(spec).toContain(`"format":"${format}"`);
    }
  });

  it('does not tell an anchorless prompt to anchor the guidance it just dropped', () => {
    const block = guidanceBlock('Ask harder questions.', { anchor: false });
    expect(block).toContain('cannot override is the output contract');
    expect(block).not.toContain('"source"');
  });
});

/*
  The row that took the most tuning. Asked for one statement and its answer, a
  model writes what the note says: the answers came back true four times in
  five, and the false ones were shorter and flatter than the true ones, so the
  reader could pick them off without knowing the subject. These pin the wording
  that replaced it — the pair, and the tells that would give one half away.
*/
describe('formatSpec — the true/false row', () => {
  const spec = formatSpec({ anchor: true });

  it('asks for both halves and refuses the model the answer', () => {
    expect(spec).toMatch(/A MATCHED PAIR, never a single statement/);
    expect(spec).toMatch(/ONE OF\s+THE TWO IS SHOWN/);
    expect(spec).toMatch(/coin flip you do not see/);
  });

  it('names what gives one half away', () => {
    // Abstract "make them similar" is ignored; the specific tells are followed.
    expect(spec).toMatch(/THE COIN-FLIP TEST/);
    expect(spec).toMatch(/LENGTH AND TEXTURE/);
    expect(spec).toMatch(/MORE THAN ONE CLAIM/);
  });

  it('keeps the observed failure as its worked example', () => {
    // Verbatim from a real generated question: three claims in one stem, all
    // fitting together, answerable as "true" by anyone who read it carefully.
    expect(spec).toContain('American scientists in the mid-1800s lent support');
    expect(spec).toContain('Skull measurements were used in the');
  });

  it('rules out the distortions that answer themselves', () => {
    expect(spec).toMatch(/NEVER DISTORT BY/);
    expect(spec).toMatch(/plain negation/);
    expect(spec).toContain('"always", "never", "all", "only"');
  });

  it('points at the misconception as the distortion worth writing', () => {
    expect(spec).toMatch(/common misconception is the strongest distortion/);
  });

  it('holds the format back for facts with a real rival', () => {
    expect(spec).toMatch(/USE THIS FORMAT ONLY/);
    expect(spec).toMatch(/four plausible answers exist/);
  });

  it('asks for an explanation that reads right whichever half was shown', () => {
    // It cannot say "this is true because": half the time it is explaining a
    // statement the reader was asked to reject.
    expect(spec).toMatch(/whichever statement was shown/);
    expect(spec).toMatch(/"whyWrong" is\s+one clause/);
  });

  it('keeps its JSON example flat, so the source clause stays inside it', () => {
    const example = spec.slice(spec.indexOf('"format":"true-false"'));
    expect(example.slice(0, example.indexOf('}'))).toContain('"source"');
  });
});

describe('formatSpec — the timeline row', () => {
  const spec = formatSpec({ anchor: true });

  it('asks for the events already in order rather than a separate answer key', () => {
    // Two fields the model could contradict itself with, for no gain — the
    // view shuffles at render, so the stored order never reaches the reader.
    expect(spec).toMatch(/IN THE\s+ORDER THEY HAPPENED/);
    expect(spec).toMatch(/you never say which order is correct/);
  });

  /*
    The failure that would quietly destroy the format: a label carrying its own
    date turns "remember the sequence" into "sort four strings".
  */
  it('tells the model to keep the date out of the event text', () => {
    expect(spec).toMatch(/KEEP THE DATE OUT OF THE EVENT TEXT/);
    expect(spec).toMatch(/"first", "then", "later" and\s+"finally"/);
  });

  it('says the dates run alongside, one per event', () => {
    expect(spec).toMatch(/ONE ENTRY PER EVENT in the same positions/);
  });

  /*
    `${source}` is appended inside the closing brace of every row, and the
    "asks every format for the passage" test slices to the FIRST `}`. A nested
    object in the example would sit between the two and break it — which is
    what keeps this row's shape as parallel flat arrays.
  */
  it('keeps its JSON example flat, so the source clause stays inside it', () => {
    const example = spec.slice(spec.indexOf('"format":"timeline"'));
    expect(example.slice(0, example.indexOf('}'))).toContain('"source"');
  });
});
