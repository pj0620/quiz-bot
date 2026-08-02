jest.mock('../../lib/kv', () => ({
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('../../features/llm/auth/secureKeyStore', () => ({
  readApiKey: jest.fn(async () => 'sk-ant-test'),
  writeApiKey: jest.fn(async () => undefined),
  deleteApiKey: jest.fn(async () => undefined),
}));

import { readApiKey } from '../../features/llm/auth/secureKeyStore';
import { getLlmProvider } from '../../features/llm/registry';
import type { CompletionResult } from '../../features/llm/types';
import { AppError } from '../../lib/errors';
import type { SourceContentProvider } from '../../sources/contract';
import type { GitHubRepoSource } from '../../sources/types';
import { clearAllCoverage, recordCoverage } from './coverageStore';
import { createLlmGenerator } from './llmGenerator';
import type { NoteGenerationEvent } from './contract';

const source: GitHubRepoSource = {
  id: 'github-repo:1',
  type: 'github-repo',
  addedAt: 0,
  repoId: 1,
  owner: 'pj0620',
  name: 'notes',
  fullName: 'pj0620/notes',
  defaultBranch: 'main',
  private: true,
  installationId: 10,
  accountLogin: 'pj0620',
};

const NOTE_BODY = `Border States

Kentucky stayed with the Union, and Lincoln kept troops out of it early on so
as not to pressure it towards the Confederacy.

West Virginia
A border state created during the war in 1861 from an area with few slaves.
`;

function reply(count: number): string {
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      format: 'true-false',
      prompt: `Claim number ${i} about the border states during the war.`,
      explanation: 'Because the notes say so.',
      correct: true,
    })),
  });
}

/** Records what was read, so ref pinning can be asserted. */
type Reads = { path: string; ref?: string }[];

function fakeProvider(paths: string[], reads: Reads, revision = 'commit-abc'): SourceContentProvider {
  return {
    verify: async () => ({ status: 'ok' }),
    listFiles: async () => ({
      files: paths.map((path, i) => ({ path, contentHash: `sha-${i}` })),
      truncated: false,
      revision,
    }),
    readFile: async (_source, path, options) => {
      reads.push({ path, ref: options?.ref });
      return NOTE_BODY;
    },
  };
}

/** Stubs the provider's network call without touching fetch. */
function stubCompletion(impl: (input: { model: string }) => Promise<CompletionResult>) {
  return jest
    .spyOn(getLlmProvider('anthropic'), 'complete')
    .mockImplementation(async (input) => impl({ model: input.model }));
}

function ok(count: number): CompletionResult {
  return {
    text: reply(count),
    stopReason: 'stop',
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

const PATHS = Array.from({ length: 10 }, (_, i) => `History/Note ${i}.md`);

beforeEach(() => {
  clearAllCoverage();
  jest.restoreAllMocks();
  (readApiKey as jest.MockedFunction<typeof readApiKey>).mockResolvedValue('sk-ant-test');
});

function run(
  options: {
    targetQuestions?: number;
    maxNotes?: number;
    folders?: string[];
    signal?: AbortSignal;
    reads?: Reads;
    paths?: string[];
    onNote?: (event: NoteGenerationEvent) => void;
  } = {},
) {
  const reads = options.reads ?? [];
  return createLlmGenerator('anthropic').generate({
    source,
    provider: fakeProvider(options.paths ?? PATHS, reads),
    targetQuestions: options.targetQuestions ?? 100,
    maxNotes: options.maxNotes ?? 10,
    folders: options.folders,
    onNote: options.onNote,
    signal: options.signal,
    now: 1_760_000_000_000,
  });
}

describe('stopping conditions', () => {
  it('stops once the question target is reached', async () => {
    stubCompletion(async () => ok(4));
    const result = await run({ targetQuestions: 10 });

    // 3 notes x 4 questions = 12, which is the first total at or past 10.
    expect(result.questions.length).toBeGreaterThanOrEqual(10);
    expect(result.notesScanned).toBe(3);
  });

  it('stops at the note cap even when the target is far away', async () => {
    // The cost ceiling: each note is a provider request plus a model call.
    stubCompletion(async () => ok(1));
    const result = await run({ targetQuestions: 500, maxNotes: 4 });

    expect(result.notesScanned).toBe(4);
    expect(result.questions).toHaveLength(4);
  });

  it('honours an abort signal mid-run', async () => {
    const controller = new AbortController();
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      if (calls === 2) controller.abort();
      return ok(2);
    });

    const result = await run({ signal: controller.signal, targetQuestions: 500 });
    expect(result.notesScanned).toBe(2);
  });
});

describe('reading', () => {
  it('reads at the revision the listing returned, not a moving branch ref', async () => {
    /*
      The blob hash recorded for a note comes from the listing. Reading at
      `main` instead could pair content from one commit with a hash from
      another, marking the note covered at a version nobody ever read.
    */
    stubCompletion(async () => ok(1));
    const reads: Reads = [];
    await run({ maxNotes: 3, reads });

    expect(reads).toHaveLength(3);
    for (const read of reads) {
      expect(read.ref).toBe('commit-abc');
    }
  });

  it('skips notes already covered at the same hash', async () => {
    stubCompletion(async () => ok(1));
    recordCoverage({ sourceId: source.id, path: PATHS[0], contentHash: 'sha-0', questionCount: 3 });

    const reads: Reads = [];
    await run({ maxNotes: 10, reads });

    expect(reads.map((read) => read.path)).not.toContain(PATHS[0]);
  });

  it('reports how many it skipped as already covered', async () => {
    stubCompletion(async () => ok(1));
    recordCoverage({ sourceId: source.id, path: PATHS[0], contentHash: 'sha-0', questionCount: 3 });
    recordCoverage({ sourceId: source.id, path: PATHS[1], contentHash: 'sha-1', questionCount: 3 });

    const result = await run({ maxNotes: 2 });
    expect(result.notesCovered).toBe(2);
    expect(result.notesAvailable).toBe(10);
  });

  it('applies the folder filter', async () => {
    stubCompletion(async () => ok(1));
    const reads: Reads = [];
    await run({
      paths: ['History/a.md', 'Books/b.md', 'History/c.md'],
      folders: ['Books'],
      reads,
    });

    expect(reads.map((read) => read.path)).toEqual(['Books/b.md']);
  });
});

describe('failure handling', () => {
  it('keeps going after one note fails', async () => {
    // A paid run must not be ended by a single unparseable reply.
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      if (calls === 1) return { text: 'not json at all', stopReason: 'stop', usage: { inputTokens: 5, outputTokens: 5 } };
      return ok(2);
    });

    const events: NoteGenerationEvent[] = [];
    const result = await run({ maxNotes: 3, onNote: (event) => events.push(event) });

    expect(events).toHaveLength(3);
    expect(events[0].error).toBeDefined();
    expect(events[0].questions).toHaveLength(0);
    expect(result.questions).toHaveLength(4);
  });

  it('stops immediately on a rejected key, rather than repeating it per note', async () => {
    /*
      Auth and quota failures hit every remaining note identically, so
      continuing would burn through the whole list producing one error each.
    */
    stubCompletion(async () => {
      throw new AppError('llm_unauthorized');
    });

    const events: NoteGenerationEvent[] = [];
    await expect(run({ maxNotes: 10, onNote: (event) => events.push(event) })).rejects.toMatchObject({
      code: 'llm_unauthorized',
    });
    expect(events).toHaveLength(1);
  });

  it('stops immediately when out of credit', async () => {
    stubCompletion(async () => {
      throw new AppError('llm_quota_exceeded');
    });
    await expect(run({ maxNotes: 10 })).rejects.toMatchObject({ code: 'llm_quota_exceeded' });
  });

  it('fails before listing anything when there is no key', async () => {
    // Nothing should be spent — not even a tree request — without credentials.
    (readApiKey as jest.MockedFunction<typeof readApiKey>).mockResolvedValue(null);
    const reads: Reads = [];

    await expect(run({ reads })).rejects.toMatchObject({ code: 'llm_not_configured' });
    expect(reads).toHaveLength(0);
  });
});

describe('reporting', () => {
  it('emits one event per note with its questions and usage', async () => {
    stubCompletion(async () => ok(2));
    const events: NoteGenerationEvent[] = [];
    await run({ maxNotes: 2, onNote: (event) => events.push(event) });

    expect(events).toHaveLength(2);
    expect(events[0].questions).toHaveLength(2);
    expect(events[0].contentHash).toMatch(/^sha-/);
    expect(events[0].usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(events[0].noteTitle.length).toBeGreaterThan(0);
  });

  it('totals token usage across the run', async () => {
    stubCompletion(async () => ok(1));
    const result = await run({ maxNotes: 3 });
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 150 });
  });

  it('uses the configured model', async () => {
    const models: string[] = [];
    stubCompletion(async ({ model }) => {
      models.push(model);
      return ok(1);
    });
    await run({ maxNotes: 1 });
    expect(models[0]).toBe(getLlmProvider('anthropic').defaultModel);
  });
});
