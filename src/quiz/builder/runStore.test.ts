jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('../../features/llm/credentials', () => ({
  resolveTarget: jest.fn(),
  resolveCredentials: jest.fn(),
  resolveCredentialsOrNull: jest.fn(),
}));

type MockContent = {
  files: Record<string, string>;
  reads: string[];
  verify: jest.Mock;
  listFiles: jest.Mock;
  readFile: jest.Mock;
};

const mockContent: MockContent = {
  files: {} as Record<string, string>,
  reads: [] as string[],
  verify: jest.fn(),
  listFiles: jest.fn(async () => ({
    files: Object.keys(mockContent.files).map((path) => ({ path, contentHash: `hash:${mockContent.files[path].length}` })),
    truncated: false,
    revision: 'rev-1',
  })),
  readFile: jest.fn(async (_source: unknown, path: string) => {
    mockContent.reads.push(path);
    return mockContent.files[path];
  }),
};

jest.mock('../../sources/registry', () => ({
  getSourceType: () => ({ provider: mockContent }),
}));

jest.mock('../../sources/store', () => ({
  getSources: () => [{ id: 'github-repo:1', type: 'github-repo' }],
  getSourceById: (id: string) => (id === 'github-repo:1' ? { id, type: 'github-repo' } : undefined),
}));

import { AppError } from '../../lib/errors';
import { resolveCredentials, resolveTarget } from '../../features/llm/credentials';
import { getLlmProvider } from '../../features/llm/registry';
import { setConcurrency } from '../../features/llm/settings';
import type { CompletionInput } from '../../features/llm/types';
import { clearQuestionBank, getQuestions, quizzesStore } from '../store';
import { coverageKey } from '../generation/coverage';
import { resetCatalog } from './notesCatalog';
import { cancelPlanJob, distribute, isPlanJobRunning, planRunStore, startFixDrafts, startPlanBatch } from './runStore';
import {
  acceptSpec,
  applyPlannerReply,
  baselinePlan,
  createPlan,
  getPlan,
  plansStore,
  setDraftReview,
  updatePlanSettings,
} from './store';
import { emptyScope, type PlanSpec } from './types';

const target = resolveTarget as jest.MockedFunction<typeof resolveTarget>;
const credentials = resolveCredentials as jest.MockedFunction<typeof resolveCredentials>;

const BODY =
  'The first number you see biases every estimate that follows it.\n' +
  'Kahneman calls this anchoring, and it works even when the number is obviously random.\n';

function chapter(index: number, body = BODY): [string, string] {
  return [`Books/Thinking Fast and Slow ${index} Chapter.md`, `# Chapter ${index}\n\n${body}`];
}

/** The filename a request was about, and how many it asked for. */
function requestOf(input: CompletionInput): { file: string; count: number } {
  return {
    file: /File: (.+)/.exec(input.user)?.[1] ?? '',
    count: Number(/Write (\d+) question/.exec(input.user)?.[1] ?? 0),
  };
}

function questions(file: string, count: number, format = 'multiple-choice'): string {
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, index) => ({
      format,
      prompt: `About ${file}, number ${index}?`,
      explanation: 'Because.',
      difficulty: 'core',
      choices: ['right', 'wrong', 'also wrong'],
      correctIndex: 0,
      modelAnswer: 'An answer.',
    })),
  });
}

type Responder = (input: CompletionInput) => string | Error | Promise<string>;

function useModel(responder: Responder) {
  const calls: CompletionInput[] = [];
  target.mockReturnValue({ providerId: 'anthropic', model: 'claude-sonnet-5' });
  credentials.mockResolvedValue({
    provider: {
      ...getLlmProvider('anthropic'),
      async complete(input) {
        calls.push(input);
        const outcome = await responder(input);
        if (outcome instanceof Error) throw outcome;
        return { text: outcome, stopReason: 'stop', usage: { inputTokens: 10, outputTokens: 20 } };
      },
    },
    apiKey: 'sk-test',
    model: 'claude-sonnet-5',
  });
  return calls;
}

function spec(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    version: 1,
    title: 'TFAS',
    summary: '',
    scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
    focus: [],
    avoid: [],
    formats: [],
    difficulty: 'mixed',
    questionsPerNote: 4,
    style: '',
    author: 'ai',
    updatedAt: 1,
    ...overrides,
  };
}

function acceptedPlan(overrides: Partial<PlanSpec> = {}) {
  const plan = createPlan('TFAS');
  applyPlannerReply(plan.id, { text: 'plan', spec: spec(overrides) });
  acceptSpec(plan.id);
  return plan.id;
}

async function run(planId: string, options: Parameters<typeof startPlanBatch>[1]) {
  const outcome = await startPlanBatch(planId, options);
  if (!outcome.ok) throw outcome.error;
  await outcome.done;
  return getPlan(planId)!.batches.find((batch) => batch.id === outcome.batchId)!;
}

beforeEach(() => {
  jest.clearAllMocks();
  plansStore.set({ plans: [] });
  quizzesStore.set({ quizzes: [] });
  planRunStore.set({ job: null });
  clearQuestionBank();
  resetCatalog();
  setConcurrency(1);
  mockContent.reads = [];
  mockContent.files = Object.fromEntries([1, 2, 3, 4, 5, 6].map((index) => chapter(index)));
});

describe('distribute', () => {
  it('splits a total as evenly as it goes', () => {
    expect(distribute(5, 3)).toEqual([2, 2, 1]);
    expect(distribute(2, 3)).toEqual([1, 1]);
    expect(distribute(5, 0)).toEqual([]);
  });
});

describe('samples', () => {
  it('writes five drafts across notes spread through the book, and records no coverage', async () => {
    const calls = useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'sample' });

    expect(batch.status).toBe('review');
    expect(batch.drafts).toHaveLength(5);
    expect(calls.map((call) => requestOf(call).count)).toEqual([2, 2, 1]);
    expect(batch.drafts.every((draft) => draft.planId === planId)).toBe(true);
    // Samples are a preview: the notes stay unread as far as batches are concerned.
    expect(getPlan(planId)!.coverage).toEqual({});
    expect(getQuestions()).toHaveLength(0);
  });
});

describe('batches', () => {
  it('reads notes in book order and records each one read', async () => {
    useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'batch', size: 8 });

    expect(mockContent.reads).toEqual([
      'Books/Thinking Fast and Slow 1 Chapter.md',
      'Books/Thinking Fast and Slow 2 Chapter.md',
    ]);
    expect(batch.drafts).toHaveLength(8);
    const coverage = getPlan(planId)!.coverage[coverageKey('github-repo:1', 'Books/Thinking Fast and Slow 1 Chapter.md')];
    expect(coverage).toMatchObject({ passes: 1, questionCount: 4 });
  });

  /*
    The top-up. A note that yields less than the plan's density pulls in
    another note, so "a batch of 8" is not quietly a batch of 5 — and no note
    is ever asked for less than a full pass to land on an exact number.
  */
  it('pulls in another note when one comes back thin', async () => {
    const calls = useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, file.includes(' 1 ') ? 1 : count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'batch', size: 8 });

    expect(mockContent.reads).toHaveLength(3);
    expect(calls.every((call) => requestOf(call).count === 4)).toBe(true);
    expect(batch.drafts).toHaveLength(9);
    expect(batch.notes.map((note) => note.questionCount)).toEqual([1, 4, 4]);
  });

  /*
    With two lanes, the second lane must count what the first has IN FLIGHT,
    or both would claim notes for the same missing questions and the batch
    would run well past its size.
  */
  it('counts questions still in flight when deciding whether to claim another note', async () => {
    setConcurrency(2);
    const pending: Array<() => void> = [];
    useModel(
      (input) =>
        new Promise<string>((resolve) => {
          const { file, count } = requestOf(input);
          pending.push(() => resolve(questions(file, file.includes(' 1 ') ? 1 : count)));
        }),
    );
    const planId = acceptedPlan();
    const outcome = await startPlanBatch(planId, { kind: 'batch', size: 8 });
    if (!outcome.ok) throw outcome.error;

    // Both lanes have claimed a note: 4 + 4 in flight covers the 8 asked for.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockContent.reads).toHaveLength(2);

    // Note 1 comes back thin (1 of 4): 1 in hand + 4 in flight < 8, so a third is claimed.
    pending.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockContent.reads).toHaveLength(3);

    // Note 2 lands (5 in hand, 4 in flight = 9): no fourth note.
    pending.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending.shift()!();
    await outcome.done;
    expect(mockContent.reads).toHaveLength(3);
    expect(getPlan(planId)!.batches[0].drafts).toHaveLength(9);
  });

  it('keeps going past a note that fails, and records the failure against it', async () => {
    useModel((input) => {
      const { file, count } = requestOf(input);
      return file.includes(' 1 ') ? new AppError('llm_server_error') : questions(file, count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'batch', size: 4 });

    expect(batch.status).toBe('review');
    expect(batch.notes[0]).toMatchObject({ status: 'failed' });
    expect(batch.drafts).toHaveLength(4);
    expect(getPlan(planId)!.coverage[coverageKey('github-repo:1', 'Books/Thinking Fast and Slow 1 Chapter.md')]).toMatchObject({
      passes: 0,
      failures: 1,
    });
  });

  it('stops at an account-level failure instead of paying for the same rejection again', async () => {
    const calls = useModel(() => new AppError('llm_unauthorized'));
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'batch', size: 20 });

    expect(calls).toHaveLength(1);
    expect(batch.status).toBe('failed');
    expect(batch.error).toMatch(/rejected/);
    expect(isPlanJobRunning()).toBe(false);
  });

  it('marks a note with nothing readable as read, without spending a request', async () => {
    mockContent.files = Object.fromEntries([chapter(1, '![[Pasted image 1.png]]\n'), chapter(2)]);
    const calls = useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    await run(planId, { kind: 'batch', size: 4 });

    expect(calls).toHaveLength(1);
    expect(getPlan(planId)!.coverage[coverageKey('github-repo:1', 'Books/Thinking Fast and Slow 1 Chapter.md')]).toMatchObject({
      passes: 1,
      questionCount: 0,
    });
  });

  it('keeps what was written before a cancel, and offers it for review', async () => {
    let release: () => void = () => undefined;
    useModel(async (input) => {
      const { file, count } = requestOf(input);
      if (file.includes(' 2 ')) {
        cancelPlanJob();
        await new Promise<void>((resolve) => {
          release = resolve;
          setTimeout(resolve, 0);
        });
        throw new Error('aborted');
      }
      return questions(file, count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'batch', size: 12 });
    release();

    expect(batch.status).toBe('review');
    expect(batch.drafts).toHaveLength(4);
    expect(batch.error).toMatch(/Stopped early/);
    expect(batch.notes.slice(1).every((note) => note.status === 'skipped')).toBe(true);
  });

  it('keeps a batch straight into the bank on autopilot', async () => {
    useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    updatePlanSettings(planId, { mode: 'autopilot' });
    const batch = await run(planId, { kind: 'batch', size: 4 });

    expect(batch).toMatchObject({ status: 'accepted', autoAccepted: true });
    expect(getQuestions().filter((question) => question.planId === planId)).toHaveLength(4);
    expect(getPlan(planId)!.quizId).toBeDefined();
  });

  it('never auto-keeps samples, whatever the mode', async () => {
    useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    updatePlanSettings(planId, { mode: 'autopilot' });
    expect((await run(planId, { kind: 'sample' })).status).toBe('review');
  });
});

describe('new notes', () => {
  it('writes only for notes that arrived after the baseline', async () => {
    useModel((input) => {
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    const known = Object.keys(mockContent.files).slice(0, 5).map((path) => ({
      sourceId: 'github-repo:1',
      path,
      contentHash: `hash:${mockContent.files[path].length}`,
      title: path,
    }));
    baselinePlan(planId, known);

    const batch = await run(planId, { kind: 'new-notes' });
    expect(mockContent.reads).toEqual(['Books/Thinking Fast and Slow 6 Chapter.md']);
    expect(batch.kind).toBe('new-notes');
    expect(batch.drafts).toHaveLength(4);
  });
});

describe('refusals', () => {
  it('refuses a plan nobody has accepted', async () => {
    useModel(() => questions('x', 1));
    const plan = createPlan('TFAS');
    const outcome = await startPlanBatch(plan.id, { kind: 'sample' });
    expect(outcome.ok).toBe(false);
  });

  it('refuses while a batch waits for review', async () => {
    useModel((input) => questions(requestOf(input).file, requestOf(input).count));
    const planId = acceptedPlan();
    await run(planId, { kind: 'sample' });
    const outcome = await startPlanBatch(planId, { kind: 'batch' });
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ message: expect.stringMatching(/open batch/) }) });
  });

  it('refuses the offline mock generator, which cannot follow a plan', async () => {
    target.mockReturnValue(null);
    const planId = acceptedPlan();
    const outcome = await startPlanBatch(planId, { kind: 'sample' });
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'llm_not_configured' }) });
    expect(getPlan(planId)!.batches).toHaveLength(0);
  });

  it('refuses a scope that matches nothing, before creating a batch', async () => {
    useModel(() => questions('x', 1));
    const planId = acceptedPlan({ scope: { ...emptyScope(), terms: ['Sapiens'] } });
    const outcome = await startPlanBatch(planId, { kind: 'batch' });
    expect(outcome.ok).toBe(false);
    expect(getPlan(planId)!.batches).toHaveLength(0);
  });

  it('says when every note has been read as often as the plan allows', async () => {
    useModel((input) => questions(requestOf(input).file, requestOf(input).count));
    mockContent.files = Object.fromEntries([chapter(1)]);
    const planId = acceptedPlan();
    const first = await run(planId, { kind: 'batch', size: 4 });
    expect(first.drafts).toHaveLength(4);
    plansStore.set({
      plans: plansStore.get().plans.map((plan) => ({
        ...plan,
        batches: plan.batches.map((batch) => ({ ...batch, status: 'accepted' as const })),
      })),
    });
    const outcome = await startPlanBatch(planId, { kind: 'batch' });
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ message: expect.stringMatching(/Go deeper/) }) });
  });
});

describe('fixing flagged drafts', () => {
  it('rewrites each flagged draft with its own feedback, then returns to review', async () => {
    useModel((input) => {
      if (input.user.includes('The person revising it asked for this change')) {
        return JSON.stringify({
          questions: [
            {
              format: 'multiple-choice',
              prompt: 'A sharper question?',
              explanation: 'Because.',
              choices: ['a', 'b'],
              correctIndex: 0,
            },
          ],
        });
      }
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'sample' });
    const flagged = batch.drafts[0];
    setDraftReview(planId, batch.id, flagged.id, { verdict: 'fix', tags: ['too-easy'], note: 'ask why' });

    const outcome = await startFixDrafts(planId, batch.id);
    if (!outcome.ok) throw outcome.error;
    await outcome.done;

    const fixed = getPlan(planId)!.batches.find((entry) => entry.id === batch.id)!;
    expect(fixed.status).toBe('review');
    const rewritten = fixed.drafts.find((draft) => draft.id === flagged.id)!;
    expect(rewritten).toMatchObject({ prompt: 'A sharper question?', planId });
    expect(fixed.reviews[flagged.id]).toEqual({ tags: [], note: '', revisedFrom: flagged.prompt });
  });

  it('leaves a draft as it was, with the reason, when its rewrite fails', async () => {
    useModel((input) => {
      if (input.user.includes('The person revising it asked for this change')) return new AppError('llm_server_error');
      const { file, count } = requestOf(input);
      return questions(file, count);
    });
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'sample' });
    const flagged = batch.drafts[0];
    setDraftReview(planId, batch.id, flagged.id, { verdict: 'fix', tags: ['unclear'], note: '' });

    const outcome = await startFixDrafts(planId, batch.id);
    if (!outcome.ok) throw outcome.error;
    await outcome.done;

    const after = getPlan(planId)!.batches.find((entry) => entry.id === batch.id)!;
    expect(after.drafts.find((draft) => draft.id === flagged.id)?.prompt).toBe(flagged.prompt);
    expect(after.reviews[flagged.id]).toMatchObject({ verdict: 'fix', error: expect.any(String) });
  });

  it('refuses when nothing is marked to fix', async () => {
    useModel((input) => questions(requestOf(input).file, requestOf(input).count));
    const planId = acceptedPlan();
    const batch = await run(planId, { kind: 'sample' });
    expect((await startFixDrafts(planId, batch.id)).ok).toBe(false);
  });
});
