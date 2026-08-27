jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
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
import { setGuidance } from '../../features/llm/settings';
import type { CompletionResult } from '../../features/llm/types';
import { AppError } from '../../lib/errors';
import type { SourceContentProvider } from '../../sources/contract';
import type { GitHubRepoSource } from '../../sources/types';
import { clearAllCoverage, recordCoverage } from './coverageStore';
import { createLlmGenerator } from './llmGenerator';
import type { NoteGenerationEvent, PlannedNote } from './contract';

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
      claim: `Claim number ${i} about the border states during the war holds.`,
      distortion: `Claim number ${i} about the border states during the war fails.`,
      explanation: 'Because the notes say so.',
    })),
  });
}

/** Records what was read, so ref pinning can be asserted. */
type Reads = { path: string; ref?: string }[];

function fakeProvider(
  paths: string[],
  reads: Reads,
  revision = 'commit-abc',
  body = NOTE_BODY,
): SourceContentProvider {
  return {
    verify: async () => ({ status: 'ok' }),
    listFiles: async () => ({
      files: paths.map((path, i) => ({ path, contentHash: `sha-${i}` })),
      truncated: false,
      revision,
    }),
    readFile: async (_source, path, options) => {
      reads.push({ path, ref: options?.ref });
      return body;
    },
  };
}

/** A note long enough that one request cannot cover it. */
const LONG_NOTE_BODY = Array.from({ length: 14 }, (_, index) => {
  const line = `Section ${index} records a fact that is well worth remembering later on. `;
  return `## Heading ${index}\n\n${line.repeat(12)}`;
}).join('\n\n');

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
  setGuidance('');
  (readApiKey as jest.MockedFunction<typeof readApiKey>).mockResolvedValue('sk-ant-test');
});

function run(
  options: {
    targetQuestions?: number;
    maxNotes?: number;
    folders?: string[];
    concurrency?: number;
    signal?: AbortSignal;
    reads?: Reads;
    paths?: string[];
    body?: string;
    onPlan?: (notes: PlannedNote[]) => void;
    onNoteStart?: (note: PlannedNote) => void;
    onNote?: (event: NoteGenerationEvent) => void;
  } = {},
) {
  const reads = options.reads ?? [];
  return createLlmGenerator('anthropic').generate({
    source,
    provider: fakeProvider(options.paths ?? PATHS, reads, 'commit-abc', options.body),
    targetQuestions: options.targetQuestions,
    maxNotes: options.maxNotes ?? 10,
    folders: options.folders,
    concurrency: options.concurrency,
    onPlan: options.onPlan,
    onNoteStart: options.onNoteStart,
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

  it('reads every note it was asked for when no question target is set', async () => {
    /*
      The default now. A question total stopped being a useful budget once a
      note could yield as many questions as its material is worth — notes are
      what a run actually costs, so notes are what bounds it.
    */
    stubCompletion(async () => ok(4));
    const result = await run({ targetQuestions: undefined, maxNotes: 6 });

    expect(result.notesScanned).toBe(6);
    expect(result.questions).toHaveLength(24);
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

describe('naming the work before doing it', () => {
  it('emits the whole plan before a single note is read', async () => {
    /*
      What makes the progress list a list of notes rather than a counter. The
      selection rules live in here — coverage, the folder filter, the cap — so
      the caller has no way to know what a run will touch until it says so.
    */
    stubCompletion(async () => ok(1));

    let planned: PlannedNote[] = [];
    const reads: Reads = [];
    await run({
      maxNotes: 4,
      reads,
      onPlan: (notes) => {
        planned = notes;
        // Nothing has been read at the moment the plan arrives.
        expect(reads).toHaveLength(0);
      },
    });

    expect(planned).toHaveLength(4);
    expect(planned.map((note) => note.path).sort()).toEqual(reads.map((read) => read.path).sort());
  });

  it('names notes by their full filename, extension and all', () => {
    stubCompletion(async () => ok(1));
    return run({
      paths: ['History/Thinking Fast and Slow 11 Anchoring.md'],
      onPlan: (notes) => {
        expect(notes[0].noteTitle).toBe('Thinking Fast and Slow 11 Anchoring.md');
      },
    });
  });

  it('announces each note as it is claimed', async () => {
    stubCompletion(async () => ok(1));
    const started: string[] = [];
    const finished: string[] = [];

    await run({
      maxNotes: 3,
      onNoteStart: (note) => started.push(note.path),
      onNote: (event) => finished.push(event.path),
    });

    expect(started).toHaveLength(3);
    // Every note that started also finished, so no row is left waiting.
    expect(started.sort()).toEqual(finished.sort());
  });

  it('announces a note that fails, not just ones that succeed', async () => {
    stubCompletion(async () => {
      throw new AppError('llm_bad_response');
    });

    const started: string[] = [];
    await run({ maxNotes: 2, onNoteStart: (note) => started.push(note.path) });
    expect(started).toHaveLength(2);
  });
});

describe('several notes at once', () => {
  /** Resolves only once `count` requests are in flight together. */
  function requireOverlap(count: number) {
    let live = 0;
    let peak = 0;
    const waiters: (() => void)[] = [];

    return {
      peak: () => peak,
      complete: async (): Promise<CompletionResult> => {
        live += 1;
        peak = Math.max(peak, live);

        if (live >= count) {
          // The last one in releases everybody, so this deadlocks rather than
          // passing if the generator is actually sequential.
          for (const release of waiters.splice(0)) release();
        } else {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }

        live -= 1;
        return ok(2);
      },
    };
  }

  it('really does run notes in parallel', async () => {
    const overlap = requireOverlap(2);
    stubCompletion(overlap.complete);

    const result = await run({ maxNotes: 6, concurrency: 2 });

    expect(overlap.peak()).toBe(2);
    expect(result.notesScanned).toBe(6);
  });

  it('stays sequential by default, so a caller opts in', async () => {
    let live = 0;
    let peak = 0;
    stubCompletion(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      return ok(1);
    });

    await run({ maxNotes: 4 });
    expect(peak).toBe(1);
  });

  it('reads every note exactly once across the lanes', async () => {
    stubCompletion(async () => ok(1));
    const reads: Reads = [];
    await run({ maxNotes: 10, concurrency: 3, reads });

    const paths = reads.map((read) => read.path);
    expect(paths).toHaveLength(10);
    expect(new Set(paths).size).toBe(10);
  });

  it('still emits exactly one event per note', async () => {
    // The invariant the coverage ledger depends on, now with lanes able to
    // interleave. See the note on `recordCoverage` below.
    stubCompletion(async () => ok(2));
    const events: NoteGenerationEvent[] = [];
    await run({ maxNotes: 8, concurrency: 4, onNote: (event) => events.push(event) });

    expect(events).toHaveLength(8);
    expect(new Set(events.map((event) => event.path)).size).toBe(8);
  });

  it('totals questions and usage correctly across lanes', async () => {
    // Accumulators are shared between lanes; a lost update here is money the
    // user spent that the run doesn't admit to.
    stubCompletion(async () => ok(2));
    const result = await run({ maxNotes: 10, concurrency: 3 });

    expect(result.questions).toHaveLength(20);
    expect(result.usage).toEqual({ inputTokens: 1_000, outputTokens: 500 });
  });

  it('stops every lane on a rejected key rather than one at a time', async () => {
    /*
      A fatal error is a property of the account, so each lane in flight hits
      it too. What matters is that no FURTHER notes are claimed — otherwise a
      bad key burns a request per note in the whole run.
    */
    stubCompletion(async () => {
      throw new AppError('llm_unauthorized');
    });

    const events: NoteGenerationEvent[] = [];
    await expect(
      run({ maxNotes: 10, concurrency: 2, onNote: (event) => events.push(event) }),
    ).rejects.toMatchObject({ code: 'llm_unauthorized' });

    expect(events.length).toBeLessThanOrEqual(2);
  });

  it('keeps going past a note-specific failure on one lane', async () => {
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      if (calls === 1) throw new AppError('llm_bad_response');
      return ok(2);
    });

    const events: NoteGenerationEvent[] = [];
    const result = await run({ maxNotes: 5, concurrency: 2, onNote: (event) => events.push(event) });

    expect(events).toHaveLength(5);
    expect(events.filter((event) => event.error)).toHaveLength(1);
    expect(result.questions).toHaveLength(8);
  });

  it('stops claiming notes once cancelled', async () => {
    const controller = new AbortController();
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      if (calls === 2) controller.abort();
      return ok(2);
    });

    const result = await run({ maxNotes: 10, concurrency: 2, signal: controller.signal });

    // The lanes already in flight finish and are kept; nothing new starts.
    expect(result.notesScanned).toBeLessThanOrEqual(4);
    expect(result.notesScanned).toBeGreaterThanOrEqual(2);
  });
});

describe('notes that take several requests', () => {
  /**
   * The contract that everything downstream depends on.
   *
   * Coverage is keyed on `sourceId:path` and `recordCoverage` REPLACES the row
   * rather than adding to it, while `recordFailure` keeps the previous content
   * hash. A second event for one note would therefore either lose the count or
   * mark a half-generated note as covered for good. The progress list, its
   * counter and its progress bar all assume one row per note too.
   */
  it('still reports exactly one event for a note that was split', async () => {
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      return ok(2);
    });

    const events: NoteGenerationEvent[] = [];
    await run({ maxNotes: 1, body: LONG_NOTE_BODY, onNote: (event) => events.push(event) });

    expect(calls).toBeGreaterThan(1);
    expect(events).toHaveLength(1);
    expect(events[0].modelCalls).toBe(calls);
  });

  it('sums the questions and the cost of every part into that one event', async () => {
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      // Distinct wording per part, or dedupe would collapse them.
      return {
        text: JSON.stringify({
          questions: [
            {
              format: 'true-false',
              claim: `Part ${calls} makes a claim about the material that holds.`,
              distortion: `Part ${calls} makes a claim about the material that fails.`,
              explanation: 'Because the notes say so.',
            },
          ],
        }),
        stopReason: 'stop' as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    const events: NoteGenerationEvent[] = [];
    await run({ maxNotes: 1, body: LONG_NOTE_BODY, onNote: (event) => events.push(event) });

    expect(events[0].questions).toHaveLength(calls);
    expect(events[0].usage).toEqual({ inputTokens: calls * 100, outputTokens: calls * 50 });
  });

  it('spends nothing on a note with nothing readable in it', async () => {
    // A page of screenshots: real headings, no text. Asking about it would
    // invite invention, and paying to do so is worse still.
    let calls = 0;
    stubCompletion(async () => {
      calls += 1;
      return ok(1);
    });

    const events: NoteGenerationEvent[] = [];
    await run({
      maxNotes: 1,
      body: '## Strikes\n\n![[Pasted image 1.png]]\n\n## Inflation\n\n![[Pasted image 2.png]]',
      onNote: (event) => events.push(event),
    });

    expect(calls).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].questions).toEqual([]);
    // No error, so coverage records it and it is never retried.
    expect(events[0].error).toBeUndefined();
  });
});

describe('the reader’s own generation notes', () => {
  it('reaches every request in the run', async () => {
    // The Settings field is only worth anything if it survives the whole chain
    // — settings store, generator, chunker, provider call.
    setGuidance('Ask more about people than about dates.');
    const systems: string[] = [];
    jest.spyOn(getLlmProvider('anthropic'), 'complete').mockImplementation(async (input) => {
      systems.push(input.system);
      return ok(1);
    });

    await run({ maxNotes: 3 });

    expect(systems).toHaveLength(3);
    for (const system of systems) {
      expect(system).toContain('Ask more about people than about dates.');
    }
  });

  it('uses the value from when the run started, not a mid-run edit', async () => {
    /*
      A run takes minutes and Settings stays reachable throughout. Re-reading
      per note would produce one run generated under two different sets of
      instructions, with no way to tell afterwards which note got which.
    */
    setGuidance('Original instructions.');
    const systems: string[] = [];
    jest.spyOn(getLlmProvider('anthropic'), 'complete').mockImplementation(async (input) => {
      systems.push(input.system);
      setGuidance('Changed mid-run.');
      return ok(1);
    });

    await run({ maxNotes: 3, concurrency: 1 });

    for (const system of systems) {
      expect(system).toContain('Original instructions.');
      expect(system).not.toContain('Changed mid-run.');
    }
  });
});
