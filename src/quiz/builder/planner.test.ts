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
  verify: jest.Mock;
  listFiles: jest.Mock;
  readFile: jest.Mock;
};

const mockContent: MockContent = {
  files: {} as Record<string, string>,
  verify: jest.fn(),
  listFiles: jest.fn(async () => ({
    files: Object.keys(mockContent.files).map((path) => ({ path, contentHash: `hash:${path}` })),
    truncated: false,
    revision: 'rev-1',
  })),
  readFile: jest.fn(async (_source: unknown, path: string) => mockContent.files[path]),
};

jest.mock('../../sources/registry', () => ({
  getSourceType: () => ({ provider: mockContent }),
}));

jest.mock('../../sources/store', () => ({
  getSources: () => [{ id: 'github-repo:1', type: 'github-repo' }],
  getSourceById: (id: string) => ({ id, type: 'github-repo' }),
}));

import { AppError } from '../../lib/errors';
import { resolveCredentials, resolveTarget } from '../../features/llm/credentials';
import { getLlmProvider } from '../../features/llm/registry';
import type { CompletionInput } from '../../features/llm/types';
import { clearQuestionBank, getQuestions, quizzesStore } from '../store';
import { acceptAndWrite, acceptPlan, removePlan, rethinkWithFeedback, saveEdit, startNewPlan } from './actions';
import { resetCatalog } from './notesCatalog';
import { getPlannerTurn, plannerStore, runPlannerFor, sendPlannerMessage } from './planner';
import { planRunStore } from './runStore';
import {
  acceptBatch,
  acceptSpec,
  addDrafts,
  applyPlannerReply,
  beginBatch,
  createPlan,
  getPlan,
  patchBatch,
  plansStore,
  saveHandEdit,
  setDraftReview,
} from './store';
import { emptyScope } from './types';

const target = resolveTarget as jest.MockedFunction<typeof resolveTarget>;
const credentials = resolveCredentials as jest.MockedFunction<typeof resolveCredentials>;

const PLAN = {
  title: 'TFAS — big ideas',
  summary: 'The two systems.',
  scope: { terms: ['Thinking Fast and Slow'], excludeTerms: [], folders: [] },
  focus: ['The two systems'],
  avoid: [],
  formats: [],
  difficulty: 'mixed',
  questionsPerNote: 4,
  style: '',
};

function useModel(responder: (input: CompletionInput) => string | Error | Promise<string>) {
  const calls: CompletionInput[] = [];
  target.mockReturnValue({ providerId: 'anthropic', model: 'claude-sonnet-5' });
  credentials.mockResolvedValue({
    provider: {
      ...getLlmProvider('anthropic'),
      async complete(input) {
        calls.push(input);
        const outcome = await responder(input);
        if (outcome instanceof Error) throw outcome;
        return { text: outcome, stopReason: 'stop', usage: { inputTokens: 30, outputTokens: 40 } };
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

beforeEach(() => {
  jest.clearAllMocks();
  plansStore.set({ plans: [] });
  plannerStore.set({ turns: {} });
  planRunStore.set({ job: null });
  quizzesStore.set({ quizzes: [] });
  clearQuestionBank();
  resetCatalog();
  mockContent.files = {
    'Books/Thinking Fast and Slow 1 A.md': '# A',
    'Books/Thinking Fast and Slow 2 B.md': '# B',
    'Books/Sapiens.md': '# S',
  };
});

describe('planner turns', () => {
  it('answers a new plan’s request with a reply and a first plan', async () => {
    const calls = useModel(() => JSON.stringify({ reply: 'Here is a plan for your TFAS notes.', plan: PLAN, ready: true }));
    const plan = startNewPlan('Quiz me on Thinking Fast and Slow');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const updated = getPlan(plan.id)!;
    expect(updated.spec).toMatchObject({ version: 1, title: PLAN.title });
    expect(updated.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(updated.messages[1]).toMatchObject({ planVersion: 1 });
    expect(updated.plannerUsage).toEqual({ inputTokens: 30, outputTokens: 40 });
    // The catalogue went with the request, so the planner could choose notes.
    expect(calls[0].user).toContain('Thinking Fast and Slow');
    expect(getPlannerTurn(plan.id)).toBeUndefined();
  });

  it('tells the planner how many notes its scope matches, every turn', async () => {
    const calls = useModel(() => JSON.stringify({ reply: 'ok', plan: PLAN }));
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: { ...baseSpec(), scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] } } });
    await sendPlannerMessage(plan.id, 'Make it harder');
    expect(calls[0].user).toContain("The plan's scope matches 2 of their 3 notes");
    expect(calls[0].user).toContain('READER: Make it harder');
  });

  /*
    The reader's hand edit landed while the model was thinking. The reply was
    written against the plan BEFORE that edit, so its words are shown — but its
    plan must not overwrite what the reader just did.
  */
  it('never lets a reply overwrite a hand edit made while it was thinking', async () => {
    let finish: (text: string) => void = () => undefined;
    useModel(() => new Promise<string>((resolve) => (finish = resolve)));
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: baseSpec() });

    const turn = sendPlannerMessage(plan.id, 'Change the difficulty');
    await new Promise((resolve) => setTimeout(resolve, 0));
    saveHandEdit(plan.id, { ...baseSpec(), title: 'My own title' });
    finish(JSON.stringify({ reply: 'Made it challenging.', plan: { ...PLAN, difficulty: 'challenging' } }));
    await turn;

    const updated = getPlan(plan.id)!;
    expect(updated.spec?.title).toBe('My own title');
    expect(updated.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Made it challenging.' });
  });

  it('keeps the reader’s message and records the failure when a turn fails', async () => {
    useModel(() => new AppError('llm_server_error'));
    const plan = createPlan('TFAS');
    await sendPlannerMessage(plan.id, 'Hello?');

    expect(getPlan(plan.id)!.messages.at(-1)).toMatchObject({ role: 'user', text: 'Hello?' });
    expect(getPlannerTurn(plan.id)).toMatchObject({ thinking: false, error: expect.any(AppError) });
  });

  it('bills a turn whose reply could not be used', async () => {
    useModel(() => '');
    const plan = createPlan('TFAS');
    await runPlannerFor(plan.id);
    expect(getPlan(plan.id)!.plannerUsage).toEqual({ inputTokens: 30, outputTokens: 40 });
  });

  it('refuses the mock generator with a reason the reader can act on', async () => {
    target.mockReturnValue(null);
    const plan = createPlan('TFAS');
    await runPlannerFor(plan.id);
    expect(getPlannerTurn(plan.id)?.error).toMatchObject({ code: 'llm_not_configured' });
  });

  it('ignores an empty message', async () => {
    const calls = useModel(() => '{}');
    const plan = createPlan('TFAS');
    await sendPlannerMessage(plan.id, '   ');
    expect(calls).toHaveLength(0);
    expect(getPlan(plan.id)!.messages).toHaveLength(1);
  });
});

describe('acceptPlan', () => {
  it('accepts the working plan and baselines the notes it reads', async () => {
    useModel(() => '{}');
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: { ...baseSpec(), scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] } } });
    await acceptPlan(plan.id);

    const updated = getPlan(plan.id)!;
    expect(updated.accepted?.version).toBe(1);
    expect(Object.keys(updated.seen).sort()).toEqual([
      'github-repo:1:Books/Thinking Fast and Slow 1 A.md',
      'github-repo:1:Books/Thinking Fast and Slow 2 B.md',
    ]);
    expect(updated.baselinedAt).toBeDefined();
  });
});

describe('acceptAndWrite', () => {
  /*
    A plan rethought after its samples is a new plan to try. Writing a full
    batch on the strength of samples from the OLD version would skip the very
    check samples exist for.
  */
  it('writes new samples for a new version while only samples have been kept', async () => {
    mockContent.files = Object.fromEntries(
      [1, 2, 3].map((index) => [`Books/Thinking Fast and Slow ${index} Ch.md`, `# Ch\n\n${'A sentence long enough to count as a note worth reading. '.repeat(3)}`]),
    );
    useModel((input) => {
      const file = /File: (.+)/.exec(input.user)?.[1] ?? '';
      const count = Number(/Write (\d+) question/.exec(input.user)?.[1] ?? 1);
      return JSON.stringify({
        questions: Array.from({ length: count }, (_, index) => ({
          format: 'multiple-choice',
          prompt: `${file} ${index}?`,
          explanation: 'Because.',
          choices: ['a', 'b'],
          correctIndex: 0,
        })),
      });
    });
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: baseSpec() });
    acceptSpec(plan.id);
    const samples = beginBatch(plan.id, { kind: 'sample', requested: 5, specVersion: 1, notes: [] })!;
    addDrafts(plan.id, samples.id, [draft('s1')]);
    patchBatch(plan.id, samples.id, (current) => ({ ...current, status: 'review' }));
    acceptBatch(plan.id, samples.id);

    applyPlannerReply(plan.id, { text: 'v2', spec: { ...baseSpec(), version: 2, difficulty: 'challenging' } });
    const outcome = await acceptAndWrite(plan.id);
    if (!outcome.ok) throw outcome.error;
    await outcome.done;
    expect(getPlan(plan.id)!.batches.at(-1)?.kind).toBe('sample');
  });
});

describe('saveEdit', () => {
  /*
    Widening a plan by hand brings in notes the reader just chose. They are
    backlog, not news — left unbaselined, the watcher would write for them
    unprompted as "new notes".
  */
  it('baselines the notes a hand-widened scope brings in', async () => {
    useModel(() => '{}');
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: baseSpec() });
    await acceptPlan(plan.id);
    expect(getPlan(plan.id)!.seen['github-repo:1:Books/Sapiens.md']).toBeUndefined();

    await saveEdit(plan.id, { ...baseSpec(), scope: { ...emptyScope(), terms: ['Thinking Fast and Slow', 'Sapiens'] } });
    const updated = getPlan(plan.id)!;
    expect(updated.accepted?.scope.terms).toEqual(['Thinking Fast and Slow', 'Sapiens']);
    expect(updated.seen['github-repo:1:Books/Sapiens.md']).toBe('hash:Books/Sapiens.md');
  });
});

describe('removePlan', () => {
  it('stops the plan’s turn in flight before deleting it', async () => {
    let started = false;
    useModel(
      (input) =>
        new Promise<string>((_resolve, reject) => {
          started = true;
          input.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const plan = createPlan('TFAS');
    const turn = runPlannerFor(plan.id);
    for (let index = 0; index < 5 && !started; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(true);

    removePlan(plan.id, { withQuestions: false });
    await turn;
    expect(getPlan(plan.id)).toBeUndefined();
    expect(getPlannerTurn(plan.id)).toBeUndefined();
  });
});

describe('rethinkWithFeedback', () => {
  it('keeps the unflagged drafts, sends the digest, and asks the planner for a new plan', async () => {
    const calls = useModel(() =>
      JSON.stringify({ reply: 'I added a rule to skip study details.', plan: { ...PLAN, avoid: ['Study details'] } }),
    );
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: baseSpec() });
    acceptSpec(plan.id);
    const batch = beginBatch(plan.id, { kind: 'batch', requested: 3, specVersion: 1, notes: [] })!;
    addDrafts(plan.id, batch.id, [draft('a'), draft('b'), draft('c')]);
    patchBatch(plan.id, batch.id, (current) => ({ ...current, status: 'review' }));
    setDraftReview(plan.id, batch.id, 'b', { verdict: 'fix', tags: ['trivia'], note: 'no study details' });

    expect(rethinkWithFeedback(plan.id, batch.id)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getQuestions().map((question) => question.id).sort()).toEqual(['a', 'c']);
    const updated = getPlan(plan.id)!;
    const feedback = updated.messages.find((message) => message.kind === 'feedback');
    expect(feedback?.text).toContain('"no study details"');
    expect(calls[0].user).toContain('READER (review feedback)');
    expect(updated.spec?.avoid).toEqual(['Study details']);
    // The new version waits for the reader to accept it.
    expect(updated.accepted?.version).toBe(1);
    expect(updated.spec?.version).toBe(2);
  });

  /*
    The reader sent a chat message, then rethought the plan from a review
    while that turn was still thinking. The turn in flight was built without
    the feedback — so it is stopped, and a fresh turn answers with it.
  */
  it('supersedes a turn already thinking, so the feedback is answered', async () => {
    const prompts: string[] = [];
    let first = true;
    useModel(
      (input) =>
        new Promise<string>((resolve, reject) => {
          prompts.push(input.user);
          if (first) {
            first = false;
            input.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            return;
          }
          resolve(JSON.stringify({ reply: 'Added a rule about study details.', plan: { ...PLAN, avoid: ['Study details'] } }));
        }),
    );
    const plan = createPlan('TFAS');
    applyPlannerReply(plan.id, { text: 'v1', spec: baseSpec() });
    acceptSpec(plan.id);
    const batch = beginBatch(plan.id, { kind: 'batch', requested: 1, specVersion: 1, notes: [] })!;
    addDrafts(plan.id, batch.id, [draft('a')]);
    patchBatch(plan.id, batch.id, (current) => ({ ...current, status: 'review' }));
    setDraftReview(plan.id, batch.id, 'a', { verdict: 'drop', tags: ['trivia'], note: '' });

    const chat = sendPlannerMessage(plan.id, 'Also, keep it short');
    for (let index = 0; index < 5 && prompts.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    rethinkWithFeedback(plan.id, batch.id);
    await chat;
    for (let index = 0; index < 10 && prompts.length < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('review feedback');
    expect(prompts[1]).toContain('READER (review feedback)');
    expect(getPlan(plan.id)!.spec?.avoid).toEqual(['Study details']);
    expect(getPlannerTurn(plan.id)).toBeUndefined();
  });

  it('does nothing for a batch that is not waiting on the reader', () => {
    const plan = createPlan('TFAS');
    expect(rethinkWithFeedback(plan.id, 'missing')).toBe(false);
  });
});

function baseSpec() {
  return {
    version: 1,
    title: PLAN.title,
    summary: PLAN.summary,
    scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
    focus: [...PLAN.focus],
    avoid: [],
    formats: [],
    difficulty: 'mixed' as const,
    questionsPerNote: 4,
    style: '',
    author: 'ai' as const,
    updatedAt: 1,
  };
}
