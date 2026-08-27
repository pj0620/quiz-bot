jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockSources: GitHubRepoSource[] = [];

jest.mock('../../sources/store', () => ({
  getSources: () => mockSources,
}));

jest.mock('../../sources/registry', () => ({
  getSourceType: () => ({ provider: {} }),
}));

import { AppError } from '../../lib/errors';
import type { GitHubRepoSource } from '../../sources/types';
import { removeQuestionsForSource } from '../store';
import type { MultipleChoiceQuestion } from '../types';
import { clearAllCoverage } from './coverageStore';
import { setGenerator } from './poller';
import {
  cancelGenerationRun,
  resetGenerationRun,
  runStore,
  startGenerationRun,
  type RunNote,
} from './runStore';
import type { GenerationInput, PlannedNote, QuestionGenerator } from './contract';

function makeSource(id: string): GitHubRepoSource {
  return {
    id,
    type: 'github-repo',
    addedAt: 0,
    repoId: 1,
    owner: 'o',
    name: id,
    fullName: `o/${id}`,
    defaultBranch: 'main',
    private: false,
    installationId: 1,
    accountLogin: 'o',
  };
}

function question(id: string, sourceId: string): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history'],
    difficulty: 'core',
    sourceId,
    provenance: { sourceId, path: 'a.md' },
    addedAt: 1_000,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

type Script = {
  path: string;
  questions?: string[];
  error?: AppError;
  /** Leave the note with no result at all, as cancelling mid-note does. */
  abandon?: boolean;
};

/** A generator that plans a list of notes, then plays out a fixed script. */
function scripted(script: Script[], options: { fatal?: AppError } = {}): QuestionGenerator {
  return {
    name: 'scripted',
    tracksCoverage: true,
    async generate(input: GenerationInput) {
      const sourceId = input.source.id;
      const planned: PlannedNote[] = script.map((entry) => ({
        sourceId,
        path: entry.path,
        noteTitle: entry.path,
      }));
      input.onPlan?.(planned);

      let scanned = 0;
      for (const [index, entry] of script.entries()) {
        input.onNoteStart?.(planned[index]);
        if (entry.abandon) continue;
        scanned += 1;
        input.onNote?.({
          path: entry.path,
          noteTitle: entry.path,
          contentHash: `hash-${entry.path}`,
          questions: (entry.questions ?? []).map((id) => question(id, sourceId)),
          error: entry.error,
          usage: { inputTokens: 10, outputTokens: 5 },
        });
      }

      if (options.fatal) throw options.fatal;

      return {
        questions: [],
        notesScanned: scanned,
        notesAvailable: script.length,
        usage: { inputTokens: 10 * scanned, outputTokens: 5 * scanned },
      };
    },
  };
}

function statusOf(path: string): RunNote | undefined {
  return runStore.get().notes.find((note) => note.key.endsWith(`:${path}`));
}

beforeEach(() => {
  mockSources.length = 0;
  mockSources.push(makeSource('src-1'));
  clearAllCoverage();
  removeQuestionsForSource('src-1');
  removeQuestionsForSource('src-2');
  resetGenerationRun();
  setGenerator(null);
});

afterEach(() => {
  setGenerator(null);
  resetGenerationRun();
});

describe('the run as a list of notes', () => {
  it('lists every planned note as waiting before any of them is worked on', async () => {
    let seen: RunNote[] = [];
    setGenerator({
      name: 'plan-only',
      async generate(input: GenerationInput) {
        input.onPlan?.([
          { sourceId: 'src-1', path: 'a.md', noteTitle: 'a.md' },
          { sourceId: 'src-1', path: 'b.md', noteTitle: 'b.md' },
        ]);
        seen = runStore.get().notes;
        return { questions: [], notesScanned: 0, notesAvailable: 2 };
      },
    });

    await startGenerationRun({ maxNotes: 2 });

    expect(seen.map((note) => note.title)).toEqual(['a.md', 'b.md']);
    expect(seen.every((note) => note.status === 'pending')).toBe(true);
  });

  it('moves a note through waiting, working, done', async () => {
    const seen: string[] = [];
    setGenerator({
      name: 'observed',
      async generate(input: GenerationInput) {
        const note: PlannedNote = { sourceId: 'src-1', path: 'a.md', noteTitle: 'a.md' };
        input.onPlan?.([note]);
        seen.push(statusOf('a.md')!.status);

        input.onNoteStart?.(note);
        seen.push(statusOf('a.md')!.status);

        input.onNote?.({ path: 'a.md', noteTitle: 'a.md', questions: [question('q1', 'src-1')] });
        seen.push(statusOf('a.md')!.status);

        return { questions: [], notesScanned: 1, notesAvailable: 1 };
      },
    });

    await startGenerationRun({ maxNotes: 1 });
    expect(seen).toEqual(['pending', 'running', 'done']);
  });

  it('records how many questions each note produced', async () => {
    setGenerator(
      scripted([
        { path: 'a.md', questions: ['q1', 'q2', 'q3'] },
        { path: 'b.md', questions: [] },
      ]),
    );

    await startGenerationRun({ maxNotes: 2 });

    expect(statusOf('a.md')).toMatchObject({ status: 'done', questionCount: 3 });
    // Not a failure — a page of screenshots has nothing to ask about.
    expect(statusOf('b.md')).toMatchObject({ status: 'done', questionCount: 0 });
  });

  it('marks a failed note and keeps its reason', async () => {
    setGenerator(
      scripted([
        { path: 'a.md', error: new AppError('llm_bad_response') },
        { path: 'b.md', questions: ['q1'] },
      ]),
    );

    await startGenerationRun({ maxNotes: 2 });

    expect(statusOf('a.md')?.status).toBe('failed');
    expect(statusOf('a.md')?.error).toBeTruthy();
    expect(statusOf('b.md')?.status).toBe('done');
  });

  it('keeps notes from several sources apart', async () => {
    // Two vaults can hold the same path, so the row key has to carry the source.
    mockSources.push(makeSource('src-2'));
    setGenerator(scripted([{ path: 'a.md', questions: ['q1'] }]));

    await startGenerationRun({ maxNotes: 1 });

    expect(runStore.get().notes.map((note) => note.key)).toEqual(['src-1:a.md', 'src-2:a.md']);
  });
});

describe('a run that does not finish its list', () => {
  /*
    Notes can end with no result at all: the user cancelled, a fatal error
    stopped the run, or the question target was reached. A row still saying
    "waiting" after the run is over is a promise nothing will ever keep.
  */
  it('settles notes that never got a result', async () => {
    setGenerator(
      scripted([
        { path: 'a.md', questions: ['q1'] },
        { path: 'b.md', abandon: true },
        { path: 'c.md', abandon: true },
      ]),
    );

    await startGenerationRun({ maxNotes: 3 });

    expect(statusOf('a.md')?.status).toBe('done');
    expect(statusOf('b.md')?.status).toBe('skipped');
    expect(statusOf('c.md')?.status).toBe('skipped');
  });

  it('settles them after a fatal error too, and keeps the error', async () => {
    setGenerator(
      scripted([{ path: 'a.md', questions: ['q1'] }, { path: 'b.md', abandon: true }], {
        fatal: new AppError('llm_unauthorized'),
      }),
    );

    await startGenerationRun({ maxNotes: 2 });

    expect(runStore.get().status).toBe('finished');
    expect(statusOf('b.md')?.status).toBe('skipped');
    // pollAllSources catches per-source failures, so it arrives as a run error
    // rather than as a rejected promise.
    expect(runStore.get().error).toBeTruthy();
  });

  it('reads as cancelled, not as finished, when the user stopped it', async () => {
    setGenerator({
      name: 'cancellable',
      async generate(input: GenerationInput) {
        input.onPlan?.([{ sourceId: 'src-1', path: 'a.md', noteTitle: 'a.md' }]);
        cancelGenerationRun();
        return { questions: [], notesScanned: 0, notesAvailable: 1 };
      },
    });

    await startGenerationRun({ maxNotes: 1 });

    expect(runStore.get().status).toBe('cancelled');
    expect(statusOf('a.md')?.status).toBe('skipped');
  });
});

describe('the run outliving the screen', () => {
  it('refuses to start a second run on top of one already going', async () => {
    let starts = 0;
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    setGenerator({
      name: 'slow',
      async generate() {
        starts += 1;
        await gate;
        return { questions: [], notesScanned: 0, notesAvailable: 0 };
      },
    });

    const first = startGenerationRun({ maxNotes: 1 });
    const second = startGenerationRun({ maxNotes: 1 });

    expect(second).toBe(first);
    release();
    await first;

    expect(starts).toBe(1);
  });

  it('keeps the finished run visible until it is reset', async () => {
    // The point of the store: a run can be walked away from and come back to,
    // including after it has ended.
    setGenerator(scripted([{ path: 'a.md', questions: ['q1'] }]));
    await startGenerationRun({ maxNotes: 1 });

    expect(runStore.get().status).toBe('finished');
    expect(runStore.get().notes).toHaveLength(1);
    expect(runStore.get().added).toBe(1);

    resetGenerationRun();
    expect(runStore.get().status).toBe('idle');
    expect(runStore.get().notes).toEqual([]);
  });

  it('will not reset a run that is still going', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    setGenerator({
      name: 'slow',
      async generate(input: GenerationInput) {
        input.onPlan?.([{ sourceId: 'src-1', path: 'a.md', noteTitle: 'a.md' }]);
        await gate;
        return { questions: [], notesScanned: 0, notesAvailable: 1 };
      },
    });

    const run = startGenerationRun({ maxNotes: 1 });
    resetGenerationRun();
    expect(runStore.get().status).toBe('running');
    expect(runStore.get().notes).toHaveLength(1);

    release();
    await run;
  });

  it('reports the tokens a run cost', async () => {
    setGenerator(scripted([{ path: 'a.md', questions: ['q1'] }, { path: 'b.md', questions: ['q2'] }]));
    await startGenerationRun({ maxNotes: 2 });

    expect(runStore.get().usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('totals tokens note by note, so a run in progress shows what it has spent', async () => {
    // Waiting for a clean return value would report zero for exactly the runs
    // whose cost matters most: the ones that end badly.
    const seen: number[] = [];
    setGenerator({
      name: 'observed',
      async generate(input: GenerationInput) {
        const note: PlannedNote = { sourceId: 'src-1', path: 'a.md', noteTitle: 'a.md' };
        input.onPlan?.([note]);
        input.onNote?.({
          path: 'a.md',
          noteTitle: 'a.md',
          questions: [],
          usage: { inputTokens: 700, outputTokens: 300 },
        });
        seen.push(runStore.get().usage.inputTokens);
        throw new AppError('llm_quota_exceeded');
      },
    });

    await startGenerationRun({ maxNotes: 1 });

    expect(seen).toEqual([700]);
    expect(runStore.get().usage.inputTokens).toBe(700);
  });
});
