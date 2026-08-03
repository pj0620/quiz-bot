import { ANCHORING, CIVIL_WAR } from '../../notes/__fixtures__/sampleNotes';
import { parseNote } from '../../notes/parse';
import { noteFilename, noteStem } from '../../notes/paths';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

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

  it('asks for the requested number of questions', () => {
    expect(promptFor(ANCHORING, 3)).toContain('Write up to 3 questions');
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
    expect(prompt).toMatch(/stand alone/);
  });

  it('still refuses to guess at unreadable images', () => {
    expect(prompt).toMatch(/image that was not included/);
  });

  it('documents every question format the registry knows about', () => {
    for (const format of ['multiple-choice', 'true-false', 'short-answer', 'list-recall', 'fill-blank']) {
      expect(prompt).toContain(`"format":"${format}"`);
    }
  });
});
