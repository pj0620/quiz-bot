import { ANCHORING, CIVIL_WAR, EMBED_ONLY_NOTE, FLAT_LINES } from './__fixtures__/sampleNotes';
import {
  claimsOf,
  isQuizzable,
  parseNote,
  sectionText,
  sentencesOf,
  type NoteSection,
} from './parse';
import { noteStem } from './paths';

function parseFixture(fixture: { path: string; content: string }) {
  return parseNote(fixture.content, noteStem(fixture.path));
}

function findSection(sections: NoteSection[], heading: string): NoteSection {
  const section = sections.find((candidate) => candidate.heading === heading);
  if (!section) throw new Error(`no section "${heading}" in [${sections.map((s) => s.heading).join(', ')}]`);
  return section;
}

describe('parseNote — a real note with no markdown headings', () => {
  const note = parseFixture(CIVIL_WAR);

  it('takes its title and series from the filename', () => {
    expect(note.title).toBe('First Year of Fighting');
    expect(note.series).toBe('History of America');
    expect(note.index).toBe(40);
  });

  it('infers structure from title-cased lines', () => {
    expect(note.sections.map((section) => section.heading)).toEqual([
      null,
      'Northern Advantages',
      // Both of these are genuine headings whose entire body is a screenshot.
      'Confederate Advantages',
      'Neutral Factors',
      'Border States',
      'West Virginia',
      'Slavery Still Allowed',
    ]);
  });

  it('keeps the lead-in paragraph that precedes any heading', () => {
    expect(note.sections[0].heading).toBeNull();
    expect(sectionText(note.sections[0])).toContain('overwhelming advantages');
  });

  it('extracts Term - definition lines as definitions, not prose', () => {
    const advantages = findSection(note.sections, 'Northern Advantages');
    const definitions = advantages.blocks.filter((block) => block.kind === 'definitions');
    expect(definitions).toHaveLength(1);

    const entries = definitions[0].kind === 'definitions' ? definitions[0].entries : [];
    expect(entries.map((entry) => entry.term)).toEqual([
      'Population',
      'Economic Strength',
      // Bare entry: the one advantage the writer didn't elaborate on. It must
      // stay in the list, or "name three Northern advantages" loses an answer.
      'Professional Military',
      'Presidential Leadership',
    ]);
    expect(entries[0].definition).toBe('5:2 ratio of people in north to south');
    expect(entries[2].definition).toBe('');
  });

  it('does not let a bare entry break the list into a new section', () => {
    expect(note.sections.map((section) => section.heading)).not.toContain('Professional Military');
  });

  it('does not split an ordinary sentence containing a dash', () => {
    const borderStates = findSection(note.sections, 'Border States');
    const text = sectionText(borderStates);
    expect(text).toContain('Lincoln kept troops out of kentucky early on to not pressure them');
  });

  it('counts every image embed it had to drop', () => {
    // Six screenshots carry real content we cannot read. Losing that silently
    // is how you end up generating questions about an empty section.
    expect(note.droppedEmbeds).toBe(6);
  });

  it('marks the screenshot-only sections unquizzable', () => {
    expect(isQuizzable(findSection(note.sections, 'Confederate Advantages'))).toBe(false);
    expect(isQuizzable(findSection(note.sections, 'Border States'))).toBe(true);
  });
});

describe('parseNote — conventional markdown', () => {
  const note = parseFixture(ANCHORING);

  it('prefers the frontmatter title', () => {
    expect(note.title).toBe('Anchoring');
    expect(note.series).toBe('Thinking Fast and Slow');
    expect(note.index).toBe(11);
  });

  it('reads frontmatter tags and inline tags together', () => {
    expect(note.tags).toEqual(['psychology', 'cognitive-bias', 'stats']);
  });

  it('records wiki-link targets', () => {
    expect(note.links).toEqual(['Priming']);
  });

  it('splits on real headings', () => {
    expect(note.sections.map((section) => section.heading)).toEqual([
      'Anchoring',
      'Two Mechanisms',
      'Anchoring Index',
    ]);
  });

  it('collects bullets into a list block', () => {
    const mechanisms = findSection(note.sections, 'Two Mechanisms');
    const list = mechanisms.blocks.find((block) => block.kind === 'list');
    expect(list?.kind === 'list' && list.items).toEqual([
      'Adjustment, which is a deliberate System 2 operation',
      'Priming, which is an automatic System 1 effect',
    ]);
  });

  it('joins wrapped lines into one paragraph', () => {
    const text = sectionText(note.sections[0]);
    expect(text).toContain('before estimating that quantity');
    expect(text).not.toMatch(/\n/);
  });

  it('drops fenced code entirely', () => {
    const index = findSection(note.sections, 'Anchoring Index');
    expect(sectionText(index)).not.toContain('shift in anchor)');
  });

  it('strips the inline tag from the prose it appeared in', () => {
    const index = findSection(note.sections, 'Anchoring Index');
    expect(sectionText(index)).not.toContain('#stats');
  });
});

describe('isQuizzable', () => {
  const note = parseFixture(EMBED_ONLY_NOTE);

  it('rejects a section whose only content was an embed', () => {
    const strikes = findSection(note.sections, 'Strikes');
    expect(strikes.droppedEmbeds).toBe(1);
    expect(sectionText(strikes)).toBe('');
    expect(isQuizzable(strikes)).toBe(false);
  });

  it('accepts a section with real prose', () => {
    expect(isQuizzable(findSection(note.sections, 'Inflation'))).toBe(true);
  });
});

describe('one thought per line, no bullets', () => {
  const note = parseFixture(FLAT_LINES);

  it('does not weld unrelated lines into one sentence', () => {
    const provences = findSection(note.sections, 'Provences');
    const claims = claimsOf(provences);

    // The bug this guards: these two lines became "Anger over recent draft Lee
    // was considered invincible leaving Confederates with hope", which was then
    // quoted verbatim as a true/false question.
    expect(claims).toContain('Lee was considered invincible leaving Confederates with hope');
    for (const claim of claims) {
      expect(claim).not.toContain('draft Lee was considered');
    }
  });

  it('keeps each line as its own block', () => {
    const nassau = findSection(note.sections, 'William of Nassau');
    expect(nassau.blocks).toHaveLength(2);
    expect(nassau.blocks.every((block) => block.kind === 'paragraph')).toBe(true);
  });

  it('still joins a genuinely wrapped sentence', () => {
    // A continuation line starts lowercase; a new thought starts capitalised.
    const note = parseNote('The anchoring effect occurs when people\nconsider a value first.', 'N');
    expect(sectionText(note.sections[0])).toBe(
      'The anchoring effect occurs when people consider a value first.',
    );
  });
});

describe('inline cleanup', () => {
  it('resolves a wiki link to its alias and records the target', () => {
    const note = parseNote('See [[Priming|the priming effect]] for more on this topic here.', 'Note');
    expect(sectionText(note.sections[0])).toContain('the priming effect');
    expect(note.links).toEqual(['Priming']);
  });

  it('removes an inline image embed without removing the sentence', () => {
    const note = parseNote('Growth was steady ![[chart.png]] until the crash of that autumn.', 'Note');
    expect(sectionText(note.sections[0])).toBe('Growth was steady until the crash of that autumn.');
  });

  it('strips emphasis, highlights and code spans', () => {
    const note = parseNote('The **ratio** was ==5:2== per `capita` across the north.', 'Note');
    expect(sectionText(note.sections[0])).toBe('The ratio was 5:2 per capita across the north.');
  });

  it('keeps markdown link text and drops the URL', () => {
    const note = parseNote('Read [the summary](https://example.com/x) before the seminar today.', 'Note');
    expect(sectionText(note.sections[0])).toBe('Read the summary before the seminar today.');
  });
});

describe('sentencesOf', () => {
  it('returns sentences within a usable length band', () => {
    const text =
      'Short. Kentucky overall stayed with the north and Lincoln kept troops out early on. ' +
      'It was a true brothers war in Kentucky with families on both sides of it.';
    expect(sentencesOf(text)).toEqual([
      'Kentucky overall stayed with the north and Lincoln kept troops out early on.',
      'It was a true brothers war in Kentucky with families on both sides of it.',
    ]);
  });

  it('keeps a final sentence with no terminal punctuation', () => {
    const text = 'Delaware was least important and had strong ties with the Union throughout';
    expect(sentencesOf(text)).toHaveLength(1);
  });
});
