import {
  ANCHORING,
  CIVIL_WAR,
  EMBED_ONLY_NOTE,
  FORT_SUMTER,
} from '../../notes/__fixtures__/sampleNotes';
import { isWithinDays } from '../../lib/day';
import type { SourceContentProvider } from '../../sources/contract';
import type { GitHubRepoSource } from '../../sources/types';
import { isValidQuestion } from '../questionTypes/registry';
import { chooseCloze, noteGenerator } from './noteGenerator';
import type { NoteGenerationEvent, PlannedNote } from './contract';

const source: GitHubRepoSource = {
  id: 'github-repo:1',
  type: 'github-repo',
  addedAt: 1_700_000_000_000,
  repoId: 1,
  owner: 'pj0620',
  name: 'notes',
  fullName: 'pj0620/notes',
  defaultBranch: 'main',
  private: true,
  installationId: 10,
  accountLogin: 'pj0620',
};

function fakeProvider(files: { path: string; content: string }[]): SourceContentProvider {
  return {
    verify: async () => ({ status: 'ok' }),
    listFiles: async () => ({
      files: files.map((file) => ({ path: file.path, size: file.content.length })),
      truncated: false,
      revision: 'a1b2c3d4e5f6',
    }),
    readFile: async (_source, path) => {
      const found = files.find((file) => file.path === path);
      if (!found) throw new Error(`missing ${path}`);
      return found.content;
    },
  };
}

const NOTES = [CIVIL_WAR, FORT_SUMTER, ANCHORING, EMBED_ONLY_NOTE];
const provider = fakeProvider(NOTES);

function generate(
  options: {
    provider?: SourceContentProvider;
    limit?: number;
    folders?: string[];
    concurrency?: number;
    onPlan?: (notes: PlannedNote[]) => void;
    onNoteStart?: (note: PlannedNote) => void;
    onNote?: (event: NoteGenerationEvent) => void;
  } = {},
) {
  return noteGenerator.generate({
    source,
    provider: options.provider ?? provider,
    targetQuestions: options.limit ?? 40,
    maxNotes: 60,
    folders: options.folders,
    concurrency: options.concurrency,
    onPlan: options.onPlan,
    onNoteStart: options.onNoteStart,
    onNote: options.onNote,
    now: 1_760_000_000_000,
  });
}

describe('noteGenerator — reporting progress', () => {
  it('names every note it will read before reading any of them', async () => {
    let planned: PlannedNote[] = [];
    await generate({ onPlan: (notes) => (planned = notes) });

    expect(planned.map((note) => note.path).sort()).toEqual(NOTES.map((note) => note.path).sort());
    // Full filenames, so the progress list matches what is in the vault.
    expect(planned.every((note) => note.noteTitle.endsWith('.md'))).toBe(true);
  });

  it('announces each note as its read starts', async () => {
    const started: string[] = [];
    await generate({ onNoteStart: (note) => started.push(note.path) });
    expect(started.sort()).toEqual(NOTES.map((note) => note.path).sort());
  });

  it('reports a note it could not read, instead of leaving it hanging', async () => {
    // Its row would otherwise sit at "working" for good — a result that never
    // arrives reads as a stuck app rather than as one bad file.
    const broken = fakeProvider(NOTES.slice(0, 2));
    const events: NoteGenerationEvent[] = [];
    await noteGenerator.generate({
      source,
      // Lists four notes but can only read two of them.
      provider: {
        ...broken,
        listFiles: async () => ({
          files: NOTES.map((note) => ({ path: note.path })),
          truncated: false,
          revision: 'a1b2c3d4e5f6',
        }),
      },
      maxNotes: 60,
      now: 1_760_000_000_000,
      onNote: (event) => events.push(event),
    });

    const failures = events.filter((event) => event.error);
    expect(failures).toHaveLength(2);
    expect(failures.every((event) => event.questions.length === 0)).toBe(true);
  });

  it('gives the same questions however many notes are read at once', async () => {
    /*
      Reads run in parallel, so replies arrive in whatever order the network
      decides — but position in the loaded list feeds the backdating that
      spreads questions across a window for the Daily quiz. Writing by index
      rather than appending on arrival is what keeps that stable.
    */
    const sequential = await generate({ concurrency: 1 });
    const parallel = await generate({ concurrency: 4 });

    expect(parallel.questions.map((question) => question.id)).toEqual(
      sequential.questions.map((question) => question.id),
    );
    expect(parallel.questions.map((question) => question.addedAt)).toEqual(
      sequential.questions.map((question) => question.addedAt),
    );
  });
});

describe('noteGenerator — what it reads', () => {
  it('reads only markdown notes', async () => {
    const mixed = fakeProvider([
      ...NOTES,
      { path: 'History/Pasted image 20260707210812.png', content: 'binary' },
      { path: 'scripts/build.ts', content: 'export const x = 1;' },
      { path: '.obsidian/workspace.md', content: '# workspace\n\nlots of config text here to pass length checks.' },
    ]);
    const result = await generate({ provider: mixed });

    const paths = new Set(result.questions.map((question) => question.provenance.path));
    for (const path of paths) {
      expect(path?.endsWith('.md')).toBe(true);
      expect(path?.startsWith('.obsidian/')).toBe(false);
    }
  });

  it('reports how many notes exist separately from how many it read', async () => {
    const result = await generate();
    expect(result.notesAvailable).toBe(NOTES.length);
    expect(result.notesScanned).toBe(NOTES.length);
  });

  it('reports zero notes available for a repository with no markdown', async () => {
    // The case worth naming in the UI: someone connected a code repository.
    const codeOnly = fakeProvider([{ path: 'src/index.ts', content: 'export const x = 1;' }]);
    const result = await generate({ provider: codeOnly });

    expect(result.notesAvailable).toBe(0);
    expect(result.questions).toHaveLength(0);
  });

  it('survives a note it cannot read', async () => {
    const flaky: SourceContentProvider = {
      ...provider,
      readFile: async (src, path) => {
        if (path === CIVIL_WAR.path) throw new Error('403');
        return provider.readFile(src, path);
      },
    };
    const result = await generate({ provider: flaky });

    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.every((q) => q.provenance.path !== CIVIL_WAR.path)).toBe(true);
  });
});

describe('noteGenerator — topics', () => {
  it('collapses a numbered series onto one topic', async () => {
    const result = await generate();
    const history = result.questions.filter((question) =>
      question.provenance.path?.startsWith('History/History of America'),
    );

    expect(history.length).toBeGreaterThan(1);
    // Two different notes, one shared subject. This is the whole reason the
    // filename is parsed instead of being slugified whole.
    expect(new Set(history.map((question) => question.provenance.path)).size).toBe(2);
    for (const question of history) {
      expect(question.topics).toContain('history-of-america');
    }
  });

  it('uses frontmatter tags when a note has them', async () => {
    const result = await generate();
    const anchoring = result.questions.filter((q) => q.provenance.path === ANCHORING.path);

    expect(anchoring.length).toBeGreaterThan(0);
    expect(anchoring[0].topics).toContain('thinking-fast-and-slow');
    expect(anchoring[0].topics).toContain('psychology');
  });

  it('never emits an empty topic list', async () => {
    const result = await generate();
    for (const question of result.questions) {
      expect(question.topics.length).toBeGreaterThan(0);
      expect(question.topics.every((topic) => topic.length > 0)).toBe(true);
    }
  });
});

describe('noteGenerator — provenance', () => {
  it('carries the note title and section rather than only a path', async () => {
    const result = await generate();
    for (const question of result.questions) {
      expect(question.provenance.sourceId).toBe(source.id);
      expect(question.provenance.revision).toBe('a1b2c3d4e5f6');
      expect(question.provenance.noteTitle).toBeTruthy();
      expect((question.provenance.excerpt ?? '').length).toBeGreaterThan(0);
    }
  });

  it('names the section a question came from', async () => {
    const result = await generate();
    const borderStates = result.questions.find(
      (question) => question.provenance.section === 'Border States',
    );
    expect(borderStates?.provenance.noteTitle).toBe('First Year of Fighting');
  });

  it('quotes the note rather than raw markdown', async () => {
    const result = await generate();
    for (const question of result.questions) {
      // The excerpt is what gets shown to a person after they answer.
      expect(question.provenance.excerpt).not.toContain('![[');
      expect(question.provenance.excerpt).not.toContain('](');
    }
  });
});

describe('noteGenerator — what it refuses to do', () => {
  it('asks nothing about a section that was only a screenshot', async () => {
    const result = await generate();
    const fromStrikes = result.questions.filter(
      (question) =>
        question.provenance.path === EMBED_ONLY_NOTE.path &&
        question.provenance.section === 'Strikes',
    );
    // "Strikes" has a heading and looks structured, but its body is an image.
    expect(fromStrikes).toHaveLength(0);
  });

  it('still generates from the readable sections of that same note', async () => {
    const result = await generate();
    const inflation = result.questions.filter(
      (question) =>
        question.provenance.path === EMBED_ONLY_NOTE.path &&
        question.provenance.section === 'Inflation',
    );
    expect(inflation.length).toBeGreaterThan(0);
  });
});

describe('noteGenerator — question quality', () => {
  it('builds recall questions from the note’s actual list', async () => {
    const result = await generate();
    const recall = result.questions.find(
      (question) => question.format === 'list-recall' && question.provenance.section === 'Northern Advantages',
    );

    expect(recall?.format === 'list-recall' && recall.items).toEqual([
      'Population',
      'Economic Strength',
      'Professional Military',
      'Presidential Leadership',
    ]);
    expect(recall?.format === 'list-recall' && recall.required).toBe(3);
  });

  it('draws multiple-choice distractors from other notes', async () => {
    const result = await generate();
    const mcq = result.questions.filter((question) => question.format === 'multiple-choice');
    expect(mcq.length).toBeGreaterThan(0);

    for (const question of mcq) {
      if (question.format !== 'multiple-choice') continue;
      expect(question.choices).toHaveLength(4);
      // Distinct text, and a correct id that actually exists — the generator
      // bug class most worth catching, since grading is by id.
      expect(new Set(question.choices.map((c) => c.text)).size).toBe(4);
      expect(question.choices.some((c) => c.id === question.correctChoiceId)).toBe(true);
    }
  });

  it('gives every question a prompt and an explanation', async () => {
    const result = await generate();
    expect(result.questions.length).toBeGreaterThan(0);
    for (const question of result.questions) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
      expect(question.explanation.trim().length).toBeGreaterThan(0);
    }
  });

  it('produces questions that pass storage validation', async () => {
    // Anything the generator emits must survive a round trip, or it silently
    // vanishes from the bank on next launch.
    const result = await generate();
    for (const question of result.questions) {
      expect(isValidQuestion(question)).toBe(true);
    }
  });

  it('spreads addedAt across a window so date rules have something to filter', async () => {
    const result = await generate();
    const days = new Set(
      result.questions.map((question) => Math.floor(question.addedAt / 86_400_000)),
    );
    expect(days.size).toBeGreaterThan(1);
  });

  it('always puts some questions inside the last 7 days', async () => {
    // The Daily quiz is the hero card on the home screen and its rule is
    // `addedWithinDays: 7`. If backdating can miss that band, the first thing
    // anyone sees after connecting a source is an empty quiz.
    const result = await generate();
    const recent = result.questions.filter((question) =>
      isWithinDays(question.addedAt, 7, 1_760_000_000_000),
    );
    expect(recent.length).toBeGreaterThan(0);
  });
});

describe('noteGenerator — determinism', () => {
  it('produces identical ids across runs', async () => {
    const first = await generate();
    const second = await generate();
    expect(second.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));
  });

  it('emits no duplicate ids within a run', async () => {
    const result = await generate();
    expect(new Set(result.questions.map((q) => q.id)).size).toBe(result.questions.length);
  });

  it('skips questions already in the bank', async () => {
    const first = await generate();
    const second = await noteGenerator.generate({
      source,
      provider,
      targetQuestions: 40,
      maxNotes: 60,
      now: 1_760_000_000_000,
      existingIds: new Set(first.questions.map((q) => q.id)),
    });
    // Re-running a poll must be a no-op, not a source of near-duplicates that
    // spaced repetition would then schedule separately.
    expect(second.questions).toHaveLength(0);
  });

  it('respects the limit', async () => {
    const result = await generate({ limit: 3 });
    expect(result.questions).toHaveLength(3);
  });
});

describe('chooseCloze', () => {
  it('prefers a figure, the hardest thing to recall', () => {
    expect(chooseCloze('Population — 5:2 ratio of people in north to south')).toEqual({
      template: 'Population — {{a}} ratio of people in north to south',
      answer: '5:2',
    });
  });

  it('falls back to a proper noun', () => {
    expect(chooseCloze('It was a true brothers war in Kentucky.')).toEqual({
      template: 'It was a true brothers war in {{a}}.',
      answer: 'Kentucky',
    });
  });

  it('never blanks the first word', () => {
    // Blanking a capitalised sentence opener leaves an unreadable stub.
    const cloze = chooseCloze('Kentucky overall stayed with the north.');
    expect(cloze?.answer).not.toBe('Kentucky');
  });

  it('gives up rather than blanking a word guessable from grammar', () => {
    expect(chooseCloze('it was so and it was not')).toBeNull();
  });
});

describe('timeline questions from a dated list', () => {
  /** A note that states its own chronology, which is the only kind this reads. */
  const DATED_NOTE = {
    path: 'History/War in the East.md',
    content: `# War in the East

## Key moments

Listed out of order, as they were written down.

- 1863 — The Emancipation Proclamation takes effect
- 1861 — Fort Sumter is shelled
- 1865 — Lee surrenders at Appomattox
- 1862 — Antietam
`,
  };

  async function timelinesFrom(note: { path: string; content: string }) {
    const result = await generate({ provider: fakeProvider([note]) });
    return result.questions.filter((question) => question.format === 'timeline');
  }

  it('builds a timeline out of a list of dated bullets', async () => {
    const [timeline] = await timelinesFrom(DATED_NOTE);
    expect(timeline).toBeDefined();
    expect(isValidQuestion(timeline)).toBe(true);
  });

  it('orders the events even though the note lists them out of order', async () => {
    const [timeline] = await timelinesFrom(DATED_NOTE);
    if (!timeline || timeline.format !== 'timeline') throw new Error('expected a timeline');

    expect(timeline.events.map((event) => event.date)).toEqual(['1861', '1862', '1863', '1865']);
    expect(timeline.events[0].label).toBe('Fort Sumter is shelled');
  });

  it('keeps the year out of the event labels, which is the whole question', async () => {
    const [timeline] = await timelinesFrom(DATED_NOTE);
    if (!timeline || timeline.format !== 'timeline') throw new Error('expected a timeline');

    for (const event of timeline.events) {
      expect(event.label).not.toMatch(/\d{4}/);
    }
  });

  /*
    Two bullets sharing a year cannot be ordered FROM THE NOTE, and choosing
    which goes first would be exactly the invention this generator exists not
    to do.
  */
  it('refuses a list where two bullets share a year', async () => {
    const ambiguous = {
      path: 'History/Ambiguous.md',
      content: `# Ambiguous

## Moments

- 1861 — Fort Sumter is shelled
- 1861 — Bull Run
- 1865 — Lee surrenders
`,
    };
    expect(await timelinesFrom(ambiguous)).toHaveLength(0);
  });

  it('leaves an undated list alone, rather than inventing an order for it', async () => {
    const undated = {
      path: 'History/Undated.md',
      content: `# Undated

## Advantages

- Population
- Industry
- Railways
`,
    };
    expect(await timelinesFrom(undated)).toHaveLength(0);
  });

  it('prefers ordering a dated list to naming it', async () => {
    // Both structural builders fit a dated list; asking one list to be both
    // named and ordered in the same section is one question too many about it.
    const result = await generate({ provider: fakeProvider([DATED_NOTE]) });
    const formats = result.questions.map((question) => question.format);
    expect(formats).toContain('timeline');
    expect(formats).not.toContain('list-recall');
  });
});
