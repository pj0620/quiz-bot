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
  fail: boolean;
  verify: jest.Mock;
  listFiles: jest.Mock;
  readFile: jest.Mock;
};

const mockContent: MockContent = {
  files: {} as Record<string, string>,
  fail: false,
  verify: jest.fn(),
  listFiles: jest.fn(async () => {
    if (mockContent.fail) throw new Error('network is unreachable');
    return {
      files: Object.keys(mockContent.files).map((path) => ({ path, contentHash: `hash:${path}` })),
      truncated: false,
      revision: 'rev-1',
    };
  }),
  readFile: jest.fn(async (_source: unknown, path: string) => mockContent.files[path]),
};

jest.mock('../../sources/registry', () => ({
  getSourceType: () => ({ provider: mockContent }),
}));

jest.mock('../../sources/store', () => ({
  getSources: () => [{ id: 'github-repo:1', type: 'github-repo' }],
  getSourceById: (id: string) => ({ id, type: 'github-repo' }),
}));

import { resolveCredentials, resolveTarget } from '../../features/llm/credentials';
import { getLlmProvider } from '../../features/llm/registry';
import type { CompletionInput } from '../../features/llm/types';
import { clearQuestionBank, quizzesStore } from '../store';
import { resetCatalog } from './notesCatalog';
import { planRunStore } from './runStore';
import {
  acceptBatch,
  acceptSpec,
  addDrafts,
  applyPlannerReply,
  baselinePlan,
  beginBatch,
  createPlan,
  getPlan,
  patchBatch,
  plansStore,
  updatePlanSettings,
} from './store';
import { emptyScope } from './types';
import { checkPlansForNewNotes, resetWatcherForTests } from './watcher';

const target = resolveTarget as jest.MockedFunction<typeof resolveTarget>;
const credentials = resolveCredentials as jest.MockedFunction<typeof resolveCredentials>;

const BODY = 'Loss aversion means losses loom larger than gains, by roughly two to one in most studies.';

function useModel() {
  const calls: CompletionInput[] = [];
  target.mockReturnValue({ providerId: 'anthropic', model: 'claude-sonnet-5' });
  credentials.mockResolvedValue({
    provider: {
      ...getLlmProvider('anthropic'),
      async complete(input) {
        calls.push(input);
        const file = /File: (.+)/.exec(input.user)?.[1] ?? '';
        return {
          text: JSON.stringify({
            questions: [
              {
                format: 'multiple-choice',
                prompt: `What does ${file} say?`,
                explanation: 'Because.',
                choices: ['a', 'b'],
                correctIndex: 0,
              },
            ],
          }),
          stopReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    },
    apiKey: 'sk-test',
    model: 'claude-sonnet-5',
  });
  return calls;
}

function draft(id: string) {
  return {
    id,
    prompt: `Question ${id}?`,
    explanation: 'Because.',
    topics: ['tfas'],
    difficulty: 'core' as const,
    sourceId: 'github-repo:1',
    provenance: { sourceId: 'github-repo:1', path: 'Books/Thinking Fast and Slow 1 A.md' },
    addedAt: 1,
    format: 'multiple-choice' as const,
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

/** A plan in use: accepted, with a batch already kept, as a reader would leave it. */
function planInUse(): string {
  const plan = createPlan('TFAS');
  applyPlannerReply(plan.id, {
    text: 'v1',
    spec: {
      version: 1,
      title: 'TFAS',
      summary: '',
      scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
      focus: [],
      avoid: [],
      formats: [],
      difficulty: 'mixed',
      questionsPerNote: 3,
      style: '',
      author: 'ai',
      updatedAt: 1,
    },
  });
  acceptSpec(plan.id);
  const batch = beginBatch(plan.id, { kind: 'sample', requested: 1, specVersion: 1, notes: [] })!;
  addDrafts(plan.id, batch.id, [draft('kept')]);
  patchBatch(plan.id, batch.id, (current) => ({ ...current, status: 'review' }));
  acceptBatch(plan.id, batch.id);
  return plan.id;
}

function noteFor(path: string) {
  return { sourceId: 'github-repo:1', path, contentHash: `hash:${path}`, title: path };
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  jest.clearAllMocks();
  plansStore.set({ plans: [] });
  planRunStore.set({ job: null });
  quizzesStore.set({ quizzes: [] });
  clearQuestionBank();
  resetCatalog();
  resetWatcherForTests();
  mockContent.fail = false;
  mockContent.files = {
    'Books/Thinking Fast and Slow 1 A.md': `# A\n\n${BODY}`,
    'Books/Thinking Fast and Slow 2 B.md': `# B\n\n${BODY}`,
  };
});

describe('checkPlansForNewNotes', () => {
  it('baselines a plan that has none, rather than calling its whole backlog new', async () => {
    const calls = useModel();
    const planId = planInUse();
    await checkPlansForNewNotes({ force: true });

    const plan = getPlan(planId)!;
    expect(plan.baselinedAt).toBeDefined();
    expect(Object.keys(plan.seen)).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });

  it('writes a batch for a note that arrived after the baseline', async () => {
    const calls = useModel();
    const planId = planInUse();
    baselinePlan(planId, Object.keys(mockContent.files).map(noteFor));

    mockContent.files['Books/Thinking Fast and Slow 3 New chapter.md'] = `# New\n\n${BODY}`;
    await checkPlansForNewNotes({ force: true });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain('File: Thinking Fast and Slow 3 New chapter.md');
    const batch = getPlan(planId)!.batches.at(-1)!;
    expect(batch).toMatchObject({ kind: 'new-notes', status: 'review' });
  });

  it('keeps a new-notes batch straight into the bank on autopilot', async () => {
    useModel();
    const planId = planInUse();
    updatePlanSettings(planId, { mode: 'autopilot' });
    baselinePlan(planId, Object.keys(mockContent.files).map(noteFor));

    mockContent.files['Books/Thinking Fast and Slow 3 New chapter.md'] = `# New\n\n${BODY}`;
    await checkPlansForNewNotes({ force: true });
    await settle();

    expect(getPlan(planId)!.batches.at(-1)).toMatchObject({ kind: 'new-notes', status: 'accepted' });
  });

  it('leaves new notes alone when the plan is set not to write for them', async () => {
    const calls = useModel();
    const planId = planInUse();
    updatePlanSettings(planId, { autoNewNotes: false });
    baselinePlan(planId, Object.keys(mockContent.files).map(noteFor));

    mockContent.files['Books/Thinking Fast and Slow 3 New chapter.md'] = `# New\n\n${BODY}`;
    await checkPlansForNewNotes({ force: true });
    await settle();
    expect(calls).toHaveLength(0);
  });

  it('never writes unprompted for a plan still being sampled', async () => {
    const calls = useModel();
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, {
      text: 'v1',
      spec: { ...getSpecForSampling(), scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] } },
    });
    acceptSpec(plan.id);
    baselinePlan(plan.id, []);

    await checkPlansForNewNotes({ force: true });
    await settle();
    expect(calls).toHaveLength(0);
  });

  it('does nothing on a failed listing, which would make every note look new', async () => {
    const calls = useModel();
    const planId = planInUse();
    mockContent.fail = true;
    await checkPlansForNewNotes({ force: true });
    expect(getPlan(planId)!.baselinedAt).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('checks at most once per interval unless forced', async () => {
    useModel();
    planInUse();
    await checkPlansForNewNotes({ force: true });
    await checkPlansForNewNotes();
    expect(mockContent.listFiles).toHaveBeenCalledTimes(1);
  });
});

function getSpecForSampling() {
  return {
    version: 1,
    title: 'TFAS',
    summary: '',
    scope: emptyScope(),
    focus: [],
    avoid: [],
    formats: [],
    difficulty: 'mixed' as const,
    questionsPerNote: 3,
    style: '',
    author: 'ai' as const,
    updatedAt: 1,
  };
}
