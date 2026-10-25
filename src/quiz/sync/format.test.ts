import { recordReview } from '../srs/schedule';
import type {
  FillBlankQuestion,
  ListRecallQuestion,
  MultipleChoiceQuestion,
  Question,
  QuestionBase,
  ReviewState,
  ShortAnswerQuestion,
  TimelineQuestion,
  TrueFalseQuestion,
} from '../types';
import {
  isQuizFileText,
  normalizeQuestion,
  normalizeReview,
  parseQuizFile,
  quizFilePath,
  renderQuizFile,
  type QuizFileEntry,
} from './format';
import {
  classify,
  decodeComment,
  encodeComment,
  escapeCell,
  formatDay,
  formatIso,
  parseDay,
  parseIso,
  splitRow,
  unescapeValue,
  valueLine,
  asPlain,
} from './markdown';

/*
  Local-time fixtures, and expectations computed the same way rather than
  written out with an offset: the suite has to pass on an EAS worker in UTC as
  well as on a laptop in New York. (Setting process.env.TZ inside a test file
  does not change the timezone under jest.)
*/
const NOW = new Date(2026, 9, 23, 21, 30, 0).getTime();
const CREATED = new Date(2026, 9, 20, 14, 2, 11).getTime();
const OFFSET = /[+-]\d\d:\d\d/.source;

/** `2026-10-23T21-30-00Z` for whatever instant NOW is in this timezone. */
function utcStamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
}

const meta = { createdAt: NOW, planTitle: (id: string) => (id === 'plan-1' ? 'Civil War deep dive' : undefined) };

const base: QuestionBase = {
  id: 'q-1k3j9x',
  prompt: 'Which state did Lincoln keep troops out of to avoid pressuring it?',
  explanation: 'Lincoln treated Kentucky carefully; pushing it risked losing it to the Confederacy.',
  topics: ['civil-war', 'border-states', 'lincoln'],
  difficulty: 'core',
  sourceId: 'github-repo:1234',
  provenance: {
    sourceId: 'github-repo:1234',
    path: 'History/History of America 40 First Year.md',
    revision: 'ab12cd3',
    noteTitle: 'History of America 40 First Year.md',
    section: 'Border States',
    quote: 'Lincoln kept troops out of Kentucky - he did not want to pressure them',
  },
  addedAt: CREATED,
  contentAt: CREATED,
};

const mcq: MultipleChoiceQuestion = {
  ...base,
  format: 'multiple-choice',
  choices: [
    { id: 'c0', text: 'Maryland' },
    { id: 'c1', text: 'Kentucky' },
    { id: 'c2', text: 'Missouri' },
    { id: 'c3', text: 'Delaware' },
  ],
  correctChoiceId: 'c1',
};

const tf: TrueFalseQuestion = { ...base, id: 'q-tf', format: 'true-false', correct: false };

const sa: ShortAnswerQuestion = {
  ...base,
  id: 'q-sa',
  format: 'short-answer',
  modelAnswer: 'Kentucky, to avoid pushing it south.',
  acceptable: ['Kentucky', 'KY'],
  rubric: ['Names Kentucky', 'Says why'],
};

const lr: ListRecallQuestion = {
  ...base,
  id: 'q-lr',
  format: 'list-recall',
  required: 2,
  items: ['Population', 'Economic Strength', 'Professional Military'],
};

const fb: FillBlankQuestion = {
  ...base,
  id: 'q-fb',
  format: 'fill-blank',
  template: 'Population — {{a}} ratio of people in north to {{b}}.',
  blanks: [
    { id: 'a', accepted: ['5:2'] },
    { id: 'b', accepted: ['south', 'the south'] },
  ],
};

const tl: TimelineQuestion = {
  ...base,
  id: 'q-tl',
  format: 'timeline',
  events: [
    { id: 'e0', label: 'Fort Sumter is shelled', date: 'April 1861' },
    { id: 'e1', label: 'Bull Run', date: 'July 1861' },
    { id: 'e2', label: 'Lee surrenders', date: '1865' },
  ],
};

/** Renders, parses, checks the result against the normalized input, and checks idempotence. */
function roundTrip(entry: QuizFileEntry): string {
  const rendered = renderQuizFile([entry], meta);
  expect(rendered.skipped).toEqual([]);
  const parsed = parseQuizFile(rendered.text);
  expect(parsed.warnings).toEqual([]);
  expect(parsed.entries).toHaveLength(1);

  const expected: QuizFileEntry = { question: normalizeQuestion(entry.question) as Question };
  if (entry.review) expected.review = normalizeReview(entry.review);
  expect(parsed.entries[0]).toEqual(expected);

  const again = renderQuizFile(parsed.entries, meta);
  expect(again.text).toBe(rendered.text);
  return rendered.text;
}

describe('multiple choice', () => {
  it('round-trips with default ids and no ids in the comment', () => {
    const text = roundTrip({ question: mcq });
    expect(text).toContain('- ✓ Kentucky');
    expect(text).not.toContain('"ids"');
    expect(text).not.toContain('- [x]');
  });

  it('keeps hand-edited choice ids through the comment', () => {
    const text = roundTrip({
      question: { ...mcq, choices: [{ id: 'cmh3k2x', text: 'A' }, { id: 'c1', text: 'B' }], correctChoiceId: 'cmh3k2x' },
    });
    expect(text).toContain('"ids":["cmh3k2x","c1"]');
  });

  it('allows six choices with the correct one last', () => {
    const choices = ['A', 'B', 'C', 'D', 'E', 'F'].map((text, index) => ({ id: `c${index}`, text }));
    roundTrip({ question: { ...mcq, choices, correctChoiceId: 'c5' } });
  });

  it('survives choice text that looks like structure', () => {
    roundTrip({
      question: {
        ...mcq,
        choices: [
          { id: 'c0', text: '✓ looks correct but is not' },
          { id: 'c1', text: '[x] a checkbox' },
          { id: 'c2', text: '- Format: a detail line' },
          { id: 'c3', text: '\\starts with a backslash' },
          { id: 'c4', text: '**bold** and `code`' },
          { id: 'c5', text: 'Two lines,\nsecond one\n\nafter a gap' },
        ],
        correctChoiceId: 'c5',
      },
    });
  });

  it('rejects a block with two ticks or none', () => {
    const text = renderQuizFile([{ question: mcq }], meta).text;
    const none = parseQuizFile(text.replace('- ✓ Kentucky', '- Kentucky'));
    expect(none.entries).toEqual([]);
    expect(none.warnings[0].reason).toMatch(/exactly one/);
    const two = parseQuizFile(text.replace('- Maryland', '- ✓ Maryland'));
    expect(two.entries).toEqual([]);
  });
});

describe('true or false', () => {
  it('round-trips both values', () => {
    expect(roundTrip({ question: tf })).toContain('**Answer:** False');
    roundTrip({ question: { ...tf, correct: true } });
  });

  it('does not mistake an escaped prompt line for the answer', () => {
    roundTrip({ question: { ...tf, prompt: 'Is this true?\n**Answer:** False' } });
  });
});

describe('short answer', () => {
  it('round-trips with alternatives and a rubric', () => {
    const text = roundTrip({ question: sa });
    expect(text).toContain('**Model answer:** Kentucky');
    expect(text).toContain('**Also accepted:**\n- Kentucky\n- KY');
    expect(text).toContain('**A good answer covers:**\n- Names Kentucky');
  });

  it('stays a short answer when the model answer is "True"', () => {
    const parsed = parseQuizFile(roundTrip({ question: { ...sa, modelAnswer: 'True', acceptable: undefined, rubric: undefined } }));
    expect(parsed.entries[0].question.format).toBe('short-answer');
  });

  it('treats empty lists as absent and keeps multi-line answers', () => {
    const text = roundTrip({
      question: { ...sa, modelAnswer: 'Line one.\n\nLine three.', acceptable: [], rubric: ['- starts like a bullet'] },
    });
    expect(text).not.toContain('**Also accepted:**');
    expect(parseQuizFile(text).entries[0].question).not.toHaveProperty('acceptable');
  });
});

describe('name them', () => {
  it('round-trips required 1 and required = items', () => {
    roundTrip({ question: { ...lr, required: 1 } });
    roundTrip({ question: { ...lr, required: 3 } });
  });

  it('survives items that look like structure', () => {
    roundTrip({
      question: { ...lr, items: ['[x] not a checkbox', 'Format: not a detail', 'a | pipe — and a dash'] },
    });
  });
});

describe('fill in the blank', () => {
  it('round-trips with alternatives, blanks in template order and case sensitivity', () => {
    const text = roundTrip({ question: fb });
    expect(text).toContain('**Fill in:** Population — ______ ratio of people in north to ______.');
    expect(text).toContain('**Blanks:**\n1. 5:2\n2. south\n   - also accepted: the south');
    expect(text).not.toContain('"ids"');
  });

  it('reorders blanks to match the template and records non-default ids', () => {
    const text = roundTrip({
      question: {
        ...fb,
        template: 'In {{Y_1}}, the {{city-2}} fell; {{a}} led the siege.',
        blanks: [
          { id: 'a', accepted: ['Grant'], caseSensitive: true },
          { id: 'city-2', accepted: ['Vicksburg'] },
          { id: 'Y_1', accepted: ['1863'] },
        ],
      },
    });
    expect(text).toContain('"ids":["Y_1","city-2","a"]');
    expect(text).toContain('3. Grant\n   - case sensitive');
  });

  it('keeps literal underscores, a literal blank run, a fake placeholder and newlines', () => {
    roundTrip({
      question: {
        ...fb,
        template: 'snake_case and ______ stay; {{not a blank}} too.\nThen {{a}} ends it {{b}}',
      },
    });
  });

  it('keeps a blank at the very start', () => {
    roundTrip({ question: { ...fb, template: '{{a}} is the ratio; {{b}} the side.' } });
  });
});

describe('timeline', () => {
  it('round-trips three and six events', () => {
    const text = roundTrip({ question: tl });
    expect(text).toContain('| 1 | Fort Sumter is shelled | April 1861 |');
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((label, index) => ({ id: `e${index}`, label, date: `${1860 + index}` }));
    roundTrip({ question: { ...tl, events: six } });
  });

  it('escapes pipes, backslashes and newlines in cells and keeps odd ids', () => {
    const text = roundTrip({
      question: {
        ...tl,
        events: [
          { id: 'emh3k2x', label: 'A | pipe', date: 'c. 480 BC' },
          { id: 'e1', label: 'A \\ backslash — and dash', date: '1 | 2' },
          { id: 'e2', label: 'Two\nlines', date: 'later' },
        ],
      },
    });
    expect(text).toContain('A \\| pipe');
    expect(text).toContain('Two<br>lines');
    expect(text).toContain('"ids":["emh3k2x","e1","e2"]');
  });
});

describe('question base', () => {
  it('escapes explanation lines that would read as markers', () => {
    const explanation = [
      'First.',
      '> not a quote',
      '## 2. not a heading',
      '### a real sub-heading is fine',
      '- Format: not a detail',
      '**Why:** not a second why',
      '\\backslash first',
      '',
      'After a blank line.',
    ].join('\n');
    const text = roundTrip({ question: { ...mcq, explanation } });
    expect(text).toContain('\\> not a quote');
    expect(text).toContain('\\## 2. not a heading');
    expect(text).toContain('### a real sub-heading is fine');
  });

  it('omits the Why block for an empty explanation', () => {
    expect(roundTrip({ question: { ...mcq, explanation: '' } })).not.toContain('**Why:**');
  });

  it('keeps awkward prompts', () => {
    roundTrip({ question: { ...mcq, prompt: '1861. Who fired first? #trick [[Fort Sumter]] #' } });
    roundTrip({ question: { ...mcq, prompt: 'First line\n- Format: second line\n\nthird after gap' } });
  });

  it('round-trips topics of zero, one and three, and every difficulty', () => {
    expect(roundTrip({ question: { ...mcq, topics: [] } })).toContain('- Topics:\n');
    roundTrip({ question: { ...mcq, topics: ['one'] } });
    roundTrip({ question: { ...mcq, difficulty: 'intro' } });
    roundTrip({ question: { ...mcq, difficulty: 'deep' } });
  });

  it('round-trips flags with and without notes', () => {
    const text = roundTrip({
      question: { ...mcq, flagged: { reason: 'not-useful', at: NOW, note: 'Too easy.\n> and a quote-looking line' } },
    });
    expect(text).toContain('> [!warning] Flagged not-useful on ');
    expect(text).toContain('> > and a quote-looking line');
    roundTrip({ question: { ...mcq, flagged: { reason: 'wrong', at: NOW } } });
  });

  it('shows a plan title only while the plan exists and keeps the id either way', () => {
    expect(roundTrip({ question: { ...mcq, planId: 'plan-1' } })).toContain('- Plan: Civil War deep dive');
    expect(roundTrip({ question: { ...mcq, planId: 'plan-gone' } })).not.toContain('- Plan:');
  });

  it('writes Material only when it differs from Created, and defaults it back', () => {
    expect(roundTrip({ question: mcq })).not.toContain('- Material:');
    const text = roundTrip({ question: { ...mcq, contentAt: CREATED - 86_400_000 } });
    expect(text).toContain('- Material:');
    const parsed = parseQuizFile(renderQuizFile([{ question: { ...mcq, contentAt: undefined } }], meta).text);
    expect(parsed.entries[0].question.contentAt).toBe(CREATED);
  });

  it('writes Edited when the question was edited', () => {
    expect(roundTrip({ question: { ...mcq, updatedAt: NOW } })).toContain('- Edited:');
  });

  it('trims and drops milliseconds', () => {
    const parsed = parseQuizFile(
      renderQuizFile([{ question: { ...mcq, prompt: '  padded  ', addedAt: CREATED + 531 } }], meta).text,
    );
    expect(parsed.entries[0].question.prompt).toBe('padded');
    expect(parsed.entries[0].question.addedAt).toBe(CREATED);
  });

  it('refuses a question whose sourceId disagrees with its provenance', () => {
    const rendered = renderQuizFile([{ question: { ...mcq, sourceId: 'other' } }], meta);
    expect(rendered.entries).toEqual([]);
    expect(rendered.skipped).toEqual([{ id: mcq.id, reason: 'not writable as a note' }]);
  });
});

describe('provenance', () => {
  it('links to the note, shows the quote and drops the excerpt when a quote exists', () => {
    const text = roundTrip({ question: { ...mcq, provenance: { ...base.provenance, excerpt: 'dropped' } } });
    expect(text).toContain(
      '> — [[History/History of America 40 First Year|History of America 40 First Year]] › Border States',
    );
    expect(text).toContain('"pv":"quote"');
    expect(text).not.toContain('dropped');
  });

  it('shows the excerpt when there is no quote, and nothing when there is neither', () => {
    const { quote: _quote, ...withoutQuote } = base.provenance;
    const text = roundTrip({ question: { ...mcq, provenance: { ...withoutQuote, excerpt: 'An excerpt.' } } });
    expect(text).toContain('> An excerpt.\n> — [[');
    expect(text).toContain('"pv":"excerpt"');
    const bare = roundTrip({ question: { ...mcq, provenance: { ...withoutQuote } } });
    expect(bare).toContain('\n> — [[');
  });

  it('restores a filename title, keeps a custom title, and tolerates none', () => {
    roundTrip({ question: { ...mcq, provenance: { ...base.provenance, noteTitle: 'Custom Title' } } });
    const { noteTitle: _title, ...untitled } = base.provenance;
    const text = roundTrip({ question: { ...mcq, provenance: untitled } });
    expect(text).toContain('> — [[History/History of America 40 First Year]] › Border States');
  });

  it('falls back to plain text when the title cannot sit in a wikilink', () => {
    const text = roundTrip({ question: { ...mcq, provenance: { ...base.provenance, noteTitle: 'A | B' } } });
    expect(text).toContain('> — A | B › Border States');
    const { section: _section, ...noSection } = base.provenance;
    roundTrip({ question: { ...mcq, provenance: { ...noSection, noteTitle: 'A | B' } } });
    roundTrip({ question: { ...mcq, provenance: { ...base.provenance, section: 'A › B' } } });
  });

  it('handles a question with a title but no path or revision', () => {
    roundTrip({ question: { ...mcq, provenance: { sourceId: base.sourceId, noteTitle: 'Loose note', section: 'S' } } });
  });

  it('writes vocabulary words with and without a definition', () => {
    const vocab: Question = {
      ...mcq,
      sourceId: 'vocab',
      provenance: { sourceId: 'vocab', path: 'vocab/laconic', noteTitle: 'laconic', excerpt: 'Using few words.' },
    };
    const text = roundTrip({ question: vocab });
    expect(text).toContain('> Using few words.\n> — From your vocabulary · **laconic**');
    const { excerpt: _excerpt, ...noDefinition } = vocab.provenance;
    roundTrip({ question: { ...vocab, provenance: noDefinition } });
  });

  it('writes asked-for prompts on the attribution line alone', () => {
    const prompt: Question = {
      ...mcq,
      sourceId: 'prompt',
      provenance: { sourceId: 'prompt', noteTitle: 'History of the Whig Party', excerpt: 'History of the Whig Party' },
    };
    const text = roundTrip({ question: prompt });
    expect(text).toContain('\n> — Asked for: History of the Whig Party');
    expect(text).not.toContain('"pv"');
    roundTrip({ question: { ...prompt, provenance: { ...prompt.provenance, excerpt: 'Edited by hand' } } });
  });
});

describe('review state', () => {
  const first = recordReview(undefined, mcq.id, 'correct', CREATED);

  it('is omitted for a never-answered question', () => {
    expect(roundTrip({ question: mcq })).not.toContain('- Progress:');
  });

  it('round-trips a first review, a partial, a leech and extreme values', () => {
    const text = roundTrip({ question: mcq, review: first });
    expect(text).toContain('- Progress: answered 1 · missed 0 · streak 1 · Learning');
    expect(text).toMatch(
      new RegExp(`- Schedule: last 2026-10-20T14:02:11${OFFSET} \\(correct\\) · due 2026-10-21 · interval 1\\.\\d\\d days · ease 2\\.60`),
    );

    const partial = recordReview(first, mcq.id, 'partial', CREATED + 86_400_000);
    roundTrip({ question: mcq, review: partial });

    const leech: ReviewState = { ...first, lapses: 5, leech: true, lastOutcome: 'incorrect' };
    expect(roundTrip({ question: mcq, review: leech })).toContain('\n- Leech');

    roundTrip({ question: mcq, review: { ...first, ease: 1.3, intervalDays: 180 } });
    roundTrip({ question: mcq, review: { ...first, ease: 3, intervalDays: 7.28 } });
  });

  it('keeps the question and drops the state when only Progress is present', () => {
    const text = renderQuizFile([{ question: mcq, review: first }], meta).text;
    const parsed = parseQuizFile(text.replace(/\n- Schedule: [^\n]*/, ''));
    expect(parsed.entries[0].question.id).toBe(mcq.id);
    expect(parsed.entries[0].review).toBeUndefined();
    expect(parsed.warnings[0].reason).toMatch(/Progress without Schedule/);
  });
});

describe('file level', () => {
  it('renders frontmatter, a title and a summary, and ignores them on parse', () => {
    const rendered = renderQuizFile([{ question: mcq }, { question: tf }], meta);
    expect(rendered.text.startsWith('---\ntype: quizbot-questions\n')).toBe(true);
    expect(rendered.text).toContain('tags: ["quizbot", "civil-war", "border-states", "lincoln"]');
    expect(rendered.text).toContain('# Quiz questions · 23 Oct 2026');
    expect(rendered.text).toContain('2 questions added on 23 October 2026 from 1 source.');
    expect(isQuizFileText(rendered.text)).toBe(true);
    expect(isQuizFileText('# Just a note\n')).toBe(false);
  });

  it('orders by addedAt then id and numbers from one', () => {
    const rendered = renderQuizFile([{ question: { ...tf, addedAt: CREATED + 1000 } }, { question: mcq }], meta);
    expect(rendered.entries.map((entry) => entry.question.id)).toEqual([mcq.id, tf.id]);
    expect(rendered.text).toContain(`## 1. ${mcq.prompt}`);
    expect(rendered.text).toContain(`## 2. ${tf.prompt}`);
  });

  it('reads CRLF input and skips one broken block without losing the rest', () => {
    const text = renderQuizFile([{ question: mcq }, { question: tf }], meta).text;
    const broken = text.replace('**Choices:**', '**Choicez:**').replace(/\n/g, '\r\n');
    const parsed = parseQuizFile(broken);
    expect(parsed.entries.map((entry) => entry.question.id)).toEqual([tf.id]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].reason).toMatch(/no answer block/);
  });

  it('ignores a duplicate id', () => {
    const text = renderQuizFile([{ question: mcq }], meta).text;
    const block = text.slice(text.indexOf('## 1.'));
    const parsed = parseQuizFile(`${text}\n${block.replace('## 1.', '## 2.')}`);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.warnings[0].reason).toMatch(/twice/);
  });

  it('skips map-locate questions, which never enter the bank', () => {
    const mapQuestion: Question = {
      ...base,
      id: 'geo',
      format: 'map-locate',
      mapId: 'us-states',
      targetRegionId: 'us-tn',
      regionIds: ['us-tn', 'us-ky'],
    };
    const rendered = renderQuizFile([{ question: mapQuestion }], meta);
    expect(rendered.skipped).toHaveLength(1);
  });

  it('keeps double hyphens in paths out of the comment closer', () => {
    const text = roundTrip({
      question: { ...mcq, provenance: { ...base.provenance, path: 'notes/x-->y--z.md' } },
    });
    expect(text).toContain('"path":"notes/x-\\u002d>y-\\u002dz.md"');
    expect(text).toContain('|History of America 40 First Year.md]]');
  });

  it('names files by UTC stamp', () => {
    expect(quizFilePath('notes/quizzes', NOW)).toBe(`notes/quizzes/quiz-questions-${utcStamp(NOW)}.md`);
  });
});

describe('every marker survives as a value line', () => {
  const markers = [
    '**Choices:**',
    '**Answer:** True',
    '**Model answer:** x',
    '**Also accepted:**',
    '**A good answer covers:**',
    '**Name 2 of these:**',
    '**Fill in:** x',
    '**Blanks:**',
    '**In order:**',
    '**Why:** x',
    '> [!warning] Flagged wrong on 2026-01-01T00:00:00Z',
    '> quoted',
    '>',
    '- Format: x',
    '- Topics: #a',
    '- Leech',
    '## 2. heading',
    '<!-- quizbot {"id":"x"} -->',
    '- ✓ foo',
    '- [x] foo',
    '- bullet',
    '1. numbered',
    '   - sub',
    '| row |',
    '  indented',
    '\\backslash',
  ];

  it.each(markers)('%s', (marker) => {
    roundTrip({
      question: {
        ...mcq,
        prompt: `Prompt\n${marker}`,
        explanation: `Why\n${marker}`,
        choices: [
          { id: 'c0', text: marker },
          { id: 'c1', text: `Right\n${marker}` },
        ],
        correctChoiceId: 'c1',
        provenance: { ...base.provenance, quote: `Quote\n${marker}` },
        flagged: { reason: 'other', at: NOW, note: `Note\n${marker}` },
      },
    });
    roundTrip({ question: { ...lr, items: [marker, 'other'] } });
    roundTrip({ question: { ...sa, modelAnswer: `Answer\n${marker}`, acceptable: undefined, rubric: [marker] } });
  });
});

describe('markdown helpers', () => {
  it('classifies the lines the grammar depends on', () => {
    expect(classify('## 3. Prompt')).toBe('heading');
    expect(classify('<!-- quizbot {} -->')).toBe('comment');
    expect(classify('- ✓ Kentucky')).toBe('correct-choice');
    expect(classify('- [x] done')).toBe('checkbox');
    expect(classify('- Topics:')).toBe('detail');
    expect(classify('- Toast: x')).toBe('bullet');
    expect(classify('> [!warning] Flagged')).toBe('callout');
    expect(classify('>')).toBe('quote');
    expect(classify('   - also accepted: x')).toBe('sub-bullet');
    expect(classify('  continued')).toBe('indented');
    expect(classify('plain')).toBe('text');
  });

  it('escapes exactly what the parser strips', () => {
    for (const text of ['> x', '\\x', '- Format: x', 'plain', '  indented', '- bullet']) {
      expect(unescapeValue(valueLine('', text, asPlain).slice(0))).toBe(text);
    }
    expect(valueLine('', 'plain', asPlain)).toBe('plain');
    expect(valueLine('', '> x', asPlain)).toBe('\\> x');
  });

  it('splits table rows with escaped pipes and backslashes', () => {
    const row = `| 1 | ${escapeCell('a | b \\ c\nd')} | ${escapeCell('x')} |`;
    expect(splitRow(row)).toEqual(['1', 'a | b \\ c\nd', 'x']);
  });

  it('formats dates with the local offset and reads them back', () => {
    expect(formatIso(CREATED)).toMatch(new RegExp(`^2026-10-20T14:02:11${OFFSET}$`));
    expect(parseIso(formatIso(CREATED))).toBe(CREATED);
    expect(parseIso('2026-10-20')).toBeUndefined();
    expect(parseDay(formatDay(CREATED))).toBe(new Date(2026, 9, 20).getTime());
  });

  it('keeps double hyphens out of the comment closer', () => {
    const line = encodeComment({ id: 'a', path: 'x-->y--z.md' });
    expect(line.indexOf('-->')).toBe(line.length - 3);
    expect(decodeComment(line)).toEqual({ id: 'a', path: 'x-->y--z.md' });
  });
});
