jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('../../sources/store', () => ({
  getSources: jest.fn(() => []),
}));

jest.mock('../../sources/registry', () => ({
  getSourceType: jest.fn(() => ({ provider: {} })),
}));

import { setConcurrency } from '../../features/llm/settings';
import { AppError } from '../../lib/errors';
import type { GitHubRepoSource } from '../../sources/types';
import type { MultipleChoiceQuestion } from '../types';
import { removeQuestionsForSource } from '../store';
import { clearAllCoverage, getCoverageFor } from './coverageStore';
import { pollSource, setGenerator } from './poller';
import type { GenerationInput, QuestionGenerator } from './contract';

const source: GitHubRepoSource = {
  id: 'src-1',
  type: 'github-repo',
  addedAt: 0,
  repoId: 1,
  owner: 'o',
  name: 'n',
  fullName: 'o/n',
  defaultBranch: 'main',
  private: false,
  installationId: 1,
  accountLogin: 'o',
};

function question(id: string): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history'],
    difficulty: 'core',
    sourceId: source.id,
    provenance: { sourceId: source.id, path: 'a.md' },
    addedAt: 1_000,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

/** A generator that emits a fixed script of note events. */
function scripted(
  events: { path: string; questions: string[]; contentHash?: string; error?: AppError }[],
  tracksCoverage?: boolean,
): QuestionGenerator {
  return {
    name: 'scripted',
    tracksCoverage,
    async generate(input: GenerationInput) {
      for (const event of events) {
        input.onNote?.({
          path: event.path,
          noteTitle: event.path,
          contentHash: event.contentHash,
          questions: event.questions.map(question),
          error: event.error,
        });
      }
      return { questions: [], notesScanned: events.length, notesAvailable: events.length };
    },
  };
}

beforeEach(() => {
  clearAllCoverage();
  // The bank is a module-level store, so it carries over between tests and
  // `addQuestions` would dedupe against the previous test's rows.
  removeQuestionsForSource(source.id);
  setGenerator(null);
});

afterEach(() => {
  setGenerator(null);
});

describe('coverage is only written by generators that read it', () => {
  it('records coverage for a tracking generator', () => {
    setGenerator(scripted([{ path: 'a.md', questions: ['q1'], contentHash: 'sha-1' }], true));

    return pollSource(source).then(() => {
      expect(getCoverageFor(source.id, 'a.md')).toMatchObject({
        contentHash: 'sha-1',
        questionCount: 1,
      });
    });
  });

  it('records nothing for the mock, which ignores coverage', async () => {
    /*
      The bug this guards is silent and expensive: if a free mock run marked
      notes as covered, the paid generator would skip material it has never
      seen and the user would never find out why their bank stopped growing.
    */
    setGenerator(scripted([{ path: 'a.md', questions: ['q1'] }]));
    await pollSource(source);

    expect(getCoverageFor(source.id, 'a.md')).toBeUndefined();
  });

  it('records nothing on failure for the mock either', async () => {
    setGenerator(scripted([{ path: 'a.md', questions: [], error: new AppError('llm_bad_response') }]));
    await pollSource(source);

    expect(getCoverageFor(source.id, 'a.md')).toBeUndefined();
  });
});

describe('incremental saving', () => {
  it('counts questions as each note completes, not at the end', async () => {
    const seen: number[] = [];
    setGenerator(
      scripted(
        [
          { path: 'a.md', questions: ['q1', 'q2'], contentHash: 'h1' },
          { path: 'b.md', questions: ['q3'], contentHash: 'h2' },
        ],
        true,
      ),
    );

    await pollSource(source, { onProgress: ({ addedSoFar }) => seen.push(addedSoFar) });

    // A cancelled run must keep what it already paid for, which only works if
    // each note is saved as it lands.
    expect(seen).toEqual([2, 3]);
  });

  it('records a failure without marking the note covered', async () => {
    setGenerator(
      scripted([{ path: 'a.md', questions: [], error: new AppError('llm_bad_response') }], true),
    );
    await pollSource(source);

    const entry = getCoverageFor(source.id, 'a.md');
    expect(entry?.failures).toBe(1);
    expect(entry?.contentHash).toBeUndefined();
    expect(entry?.generatedAt).toBe(0);
  });
});

describe('what the poller passes down and hands back', () => {
  it('takes the concurrency from Settings when the caller does not name one', async () => {
    let seen: number | undefined;
    setGenerator({
      name: 'observed',
      async generate(input: GenerationInput) {
        seen = input.concurrency;
        return { questions: [], notesScanned: 0, notesAvailable: 0 };
      },
    });

    setConcurrency(3);
    await pollSource(source);
    expect(seen).toBe(3);
  });

  it('lets a caller override it', async () => {
    let seen: number | undefined;
    setGenerator({
      name: 'observed',
      async generate(input: GenerationInput) {
        seen = input.concurrency;
        return { questions: [], notesScanned: 0, notesAvailable: 0 };
      },
    });

    setConcurrency(3);
    await pollSource(source, { concurrency: 1 });
    expect(seen).toBe(1);
  });

  it('names the source on every progress event', async () => {
    /*
      A note event carries only a path, because a generator works inside one
      source and has no reason to repeat it. Anything watching a run across
      several sources needs the pair — two vaults can hold the same path.
    */
    setGenerator(scripted([{ path: 'a.md', questions: ['q1'], contentHash: 'h1' }], true));

    const seen: string[] = [];
    await pollSource(source, { onProgress: ({ sourceId }) => seen.push(sourceId) });

    expect(seen).toEqual([source.id]);
  });

  it('forwards the plan and the per-note start', async () => {
    setGenerator({
      name: 'planner',
      async generate(input: GenerationInput) {
        input.onPlan?.([{ sourceId: source.id, path: 'a.md', noteTitle: 'a.md' }]);
        input.onNoteStart?.({ sourceId: source.id, path: 'a.md', noteTitle: 'a.md' });
        return { questions: [], notesScanned: 1, notesAvailable: 1 };
      },
    });

    const planned: string[] = [];
    const started: string[] = [];
    await pollSource(source, {
      onPlan: (notes) => planned.push(...notes.map((note) => note.path)),
      onNoteStart: (note) => started.push(note.path),
    });

    expect(planned).toEqual(['a.md']);
    expect(started).toEqual(['a.md']);
  });
});
