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
  options: { provider?: SourceContentProvider; limit?: number; folders?: string[] } = {},
) {
  return noteGenerator.generate({
    source,
    provider: options.provider ?? provider,
    targetQuestions: options.limit ?? 40,
    maxNotes: 60,
    folders: options.folders,
    now: 1_760_000_000_000,
  });
}

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
