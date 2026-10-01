/*
  Render tests for the quiz builder's screens.

  They live here rather than beside the screens because everything under
  `app/` is a route — a test file there would become a page. Each screen is
  rendered against real stores (storage mocked) in the states a reader meets,
  which is what catches the failures a type checker cannot: a hook called
  conditionally, an element type that is undefined at runtime, a state the
  screen forgot to handle.
*/

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

/* See `RegionMap.test.tsx` — the answer views pull these in. */
jest.mock('react-native-gesture-handler', () => {
  const builder: unknown = new Proxy(() => undefined, {
    get: () => () => builder,
    apply: () => builder,
  });
  return {
    Gesture: new Proxy({}, { get: () => () => builder }),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: require('react-native').View,
  },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: (build: () => unknown) => build(),
  withTiming: (value: unknown) => value,
  runOnJS: (fn: unknown) => fn,
}));

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
  resolveTarget: jest.fn(() => null),
  resolveCredentials: jest.fn(),
  resolveCredentialsOrNull: jest.fn(async () => null),
}));

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
};
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void | (() => void)) => {
    require('react').useEffect(effect, []);
  },
  Stack: { Screen: () => null },
}));

jest.mock('expo-router/js-tabs', () => ({ Tabs: { Screen: () => null } }));
// The question screen's pronunciation button reaches for expo-audio's native module.
jest.mock('../../ui/components/PronounceButton', () => ({ PronounceButton: () => null }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type MockContent = {
  files: Record<string, string>;
  verify: jest.Mock;
  listFiles: jest.Mock;
  readFile: jest.Mock;
};

const mockContent: MockContent = {
  files: {},
  verify: jest.fn(),
  listFiles: jest.fn(async () => ({
    files: Object.keys(mockContent.files).map((path) => ({ path, contentHash: `hash:${path}` })),
    truncated: false,
    revision: 'rev-1',
  })),
  readFile: jest.fn(async (_source: unknown, path: string) => mockContent.files[path]),
};

jest.mock('../../sources/registry', () => ({
  getSourceType: () => ({ provider: mockContent, getTitle: () => 'notes', getSubtitle: () => '' }),
}));

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import BuildScreen from '../../../app/(tabs)/build';
import QuizzesScreen from '../../../app/(tabs)/quizzes';
import QuestionDetailScreen from '../../../app/questions/[id]';
import QuestionBankScreen from '../../../app/questions/index';
import PlanChatScreen from '../../../app/builder/[id]/chat';
import EditDraftScreen from '../../../app/builder/[id]/draft/[questionId]';
import EditPlanScreen from '../../../app/builder/[id]/edit';
import PlanOverviewScreen from '../../../app/builder/[id]/index';
import ReviewBatchScreen from '../../../app/builder/[id]/review/[batchId]';
import { setGeneratorId } from '../../features/llm/settings';
import { addSources, sourcesStore } from '../../sources/store';
import { addQuestions, clearQuestionBank, quizzesStore } from '../store';
import type { MultipleChoiceQuestion } from '../types';
import { refreshCatalog, resetCatalog } from './notesCatalog';
import { plannerStore } from './planner';
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
} from './store';
import { emptyScope, type PlanSpec } from './types';

const SOURCE = {
  id: 'github-repo:1',
  type: 'github-repo' as const,
  addedAt: 1,
  repoId: 1,
  owner: 'reader',
  name: 'notes',
  fullName: 'reader/notes',
  defaultBranch: 'main',
  private: true,
  installationId: 1,
  accountLogin: 'reader',
};

function spec(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    version: 1,
    title: 'Thinking Fast and Slow — big ideas',
    summary: 'The two systems and the biases they cause.',
    scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
    focus: ['How System 1 and System 2 differ'],
    avoid: ['Experiment sample sizes'],
    formats: [],
    difficulty: 'mixed',
    questionsPerNote: 4,
    style: '',
    author: 'ai',
    updatedAt: 1,
    ...overrides,
  };
}

function draft(id: string, prompt = `What does chapter ${id} argue?`): MultipleChoiceQuestion {
  return {
    id,
    prompt,
    explanation: 'Because of System 1.',
    topics: ['thinking-fast-and-slow'],
    difficulty: 'core',
    sourceId: SOURCE.id,
    provenance: {
      sourceId: SOURCE.id,
      path: 'Books/Thinking Fast and Slow 1 Characters.md',
      noteTitle: 'Thinking Fast and Slow 1 Characters',
    },
    addedAt: 1,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'The right one' },
      { id: 'c1', text: 'A wrong one' },
    ],
    correctChoiceId: 'c0',
  };
}

/** Every tree rendered, so each is unmounted before the next test writes to the stores. */
const mounted: ReactTestRenderer[] = [];

/*
  Async, so act() also flushes the promises a screen starts on mount — a focus
  effect listing the vault, the watcher baselining a plan — instead of letting
  them land after the test as unexplained updates.
*/
async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

function screenText(tree: ReactTestRenderer): string {
  return textOf(tree.root);
}

/** The innermost pressable whose text includes `label`. */
function pressable(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const matches = tree.root.findAll(
    (node) => typeof node.props.onPress === 'function' && textOf(node).includes(label),
  );
  if (matches.length === 0) throw new Error(`Nothing pressable says "${label}"`);
  return matches[matches.length - 1];
}

async function press(tree: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => {
    pressable(tree, label).props.onPress();
  });
}

function acceptedPlanId(): string {
  const plan = createPlan('Quiz me on Thinking Fast and Slow');
  applyPlannerReply(plan.id, { text: 'Here is a plan built around the two systems.', spec: spec() });
  acceptSpec(plan.id);
  return plan.id;
}

function reviewBatch(planId: string, ids: string[]) {
  const batch = beginBatch(planId, { kind: 'batch', requested: ids.length, specVersion: 1, notes: [] })!;
  addDrafts(planId, batch.id, ids.map((id) => draft(id)));
  patchBatch(planId, batch.id, (current) => ({ ...current, status: 'review' }));
  return batch.id;
}

/*
  FlatList schedules its own cell rendering on timers, which would otherwise
  fire after a test has finished and warn about updates outside act().
*/
beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  setGeneratorId('mock');
  plansStore.set({ plans: [] });
  plannerStore.set({ turns: {} });
  planRunStore.set({ job: null });
  quizzesStore.set({ quizzes: [] });
  sourcesStore.set({ sources: [], health: {} });
  clearQuestionBank();
  resetCatalog();
  addSources([SOURCE]);
  mockContent.files = {
    'Books/Thinking Fast and Slow 1 Characters.md': '# Characters',
    'Books/Thinking Fast and Slow 2 Attention.md': '# Attention',
    'Books/Sapiens.md': '# Sapiens',
  };
  await refreshCatalog({ maxAgeMs: 0 });
});

describe('the Build tab', () => {
  it('explains the flow when there are no plans yet', async () => {
    const tree = await render(<BuildScreen />);
    const text = screenText(tree);
    expect(text).toContain('Build a quiz with AI');
    expect(text).toContain('How it works');
    expect(text).toContain('Review batches');
  });

  it('offers the reader’s own series as starting points', async () => {
    setGeneratorId('anthropic');
    const text = screenText(await render(<BuildScreen />));
    expect(text).toContain('Thinking Fast and Slow · 2');
  });

  it('says a real model is needed while the offline generator is selected', async () => {
    expect(screenText(await render(<BuildScreen />))).toContain('Needs a real model');
  });

  it('lists plans with what each is waiting for', async () => {
    const planId = acceptedPlanId();
    reviewBatch(planId, ['a', 'b']);
    createPlan('A plan still being drafted');
    const text = screenText(await render(<BuildScreen />));
    expect(text).toContain('Your plans · 2');
    expect(text).toContain('Batch 1: 2 questions ready to review');
    expect(text).toContain('Waiting for a first plan');
  });
});

describe('the planner chat', () => {
  it('shows the conversation, the plan it produced, and how to accept it', async () => {
    const plan = createPlan('Quiz me on Thinking Fast and Slow');
    applyPlannerReply(plan.id, { text: 'Here is a plan built around the two systems.', spec: spec() });
    mockParams = { id: plan.id };

    const text = screenText(await render(<PlanChatScreen />));
    expect(text).toContain('Quiz me on Thinking Fast and Slow');
    expect(text).toContain('Here is a plan built around the two systems.');
    expect(text).toContain('The plan so far');
    expect(text).toContain('How System 1 and System 2 differ');
    expect(text).toContain('Notes matching “Thinking Fast and Slow” · 2 notes');
    expect(text).toContain('Accept plan & try 5 samples');
  });

  it('shows what changed since the accepted version', async () => {
    const planId = acceptedPlanId();
    applyPlannerReply(planId, { text: 'Harder now.', spec: spec({ version: 2, difficulty: 'challenging' }) });
    mockParams = { id: planId };

    const text = screenText(await render(<PlanChatScreen />));
    expect(text).toContain('Proposed changes');
    expect(text).toContain('Difficulty: Mixed → Challenging');
    expect(text).toContain('Accept v2 & try new samples');
  });

  it('returns to the plan after "just accept", rather than stacking another copy', async () => {
    const planId = acceptedPlanId();
    applyPlannerReply(planId, { text: 'Harder now.', spec: spec({ version: 2, difficulty: 'challenging' }) });
    mockParams = { id: planId };

    const tree = await render(<PlanChatScreen />);
    await press(tree, 'Just accept');
    expect(getPlan(planId)!.accepted?.version).toBe(2);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith(`/builder/${planId}`);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('says so when the scope matches nothing', async () => {
    const plan = createPlan('Quiz me on Sapiens');
    applyPlannerReply(plan.id, {
      text: 'Plan.',
      spec: spec({ scope: { ...emptyScope(), terms: ['Guns Germs and Steel'] } }),
    });
    mockParams = { id: plan.id };
    expect(screenText(await render(<PlanChatScreen />))).toContain('No notes match');
  });
});

describe('reviewing a batch', () => {
  it('shows every draft answered, with the verdicts and a decision', async () => {
    const planId = acceptedPlanId();
    const batchId = reviewBatch(planId, ['a', 'b', 'c']);
    mockParams = { id: planId, batchId };

    const text = screenText(await render(<ReviewBatchScreen />));
    expect(text).toContain('3 questions to review');
    expect(text).toContain('What does chapter a argue?');
    expect(text).toContain('The right one');
    expect(text).toContain('Needs work');
    expect(text).toContain('Keep 3 & write the next 10');
  });

  it('asks why once a draft needs work, and offers to fix it', async () => {
    const planId = acceptedPlanId();
    const batchId = reviewBatch(planId, ['a', 'b']);
    mockParams = { id: planId, batchId };

    const tree = await render(<ReviewBatchScreen />);
    await act(async () => {
      tree.root.findAll((node) => node.props.accessibilityLabel === 'Needs work, question 1')[0].props.onPress();
    });

    const text = screenText(tree);
    expect(text).toContain('Not worth knowing');
    expect(text).toContain('Fix 1 with your feedback');
    expect(text).toContain('Rethink the plan instead');
    expect(getPlan(planId)!.batches[0].reviews.a?.verdict).toBe('fix');
  });

  it('lets the reader mark drafts while the rest are still being written', async () => {
    const planId = acceptedPlanId();
    const batch = beginBatch(planId, { kind: 'batch', requested: 10, specVersion: 1, notes: [] })!;
    addDrafts(planId, batch.id, [draft('a')]);
    mockParams = { id: planId, batchId: batch.id };

    const tree = await render(<ReviewBatchScreen />);
    expect(screenText(tree)).toContain('Start reviewing below');
    await act(async () => {
      tree.root.findAll((node) => node.props.accessibilityLabel === 'Drop, question 1')[0].props.onPress();
    });
    expect(getPlan(planId)!.batches[0].reviews.a?.verdict).toBe('drop');
    // Deciding about the batch still waits for it to finish.
    expect(screenText(tree)).not.toContain('What next?');
  });

  it('keeps a batch and goes back to the plan', async () => {
    const planId = acceptedPlanId();
    const batchId = reviewBatch(planId, ['a']);
    mockParams = { id: planId, batchId };

    const tree = await render(<ReviewBatchScreen />);
    await press(tree, 'Keep 1 and stop here');
    expect(getPlan(planId)!.batches[0].status).toBe('accepted');
    expect(mockRouter.dismissTo).toHaveBeenCalledWith(`/builder/${planId}`);
  });

  it('shows a kept batch from the bank, read-only', async () => {
    const planId = acceptedPlanId();
    const batchId = reviewBatch(planId, ['a']);
    acceptBatch(planId, batchId);
    mockParams = { id: planId, batchId };

    const text = screenText(await render(<ReviewBatchScreen />));
    expect(text).toContain('Kept 1');
    expect(text).toContain('What does chapter a argue?');
    expect(text).not.toContain('What next?');
  });
});

describe('the plan overview', () => {
  it('leads with samples for a plan that has kept nothing', async () => {
    mockParams = { id: acceptedPlanId() };
    const text = screenText(await render(<PlanOverviewScreen />));
    expect(text).toContain('Try the plan out');
    expect(text).toContain('Write 5 sample questions');
    expect(text).toContain('The plan');
  });

  it('points at a batch waiting for review before anything else', async () => {
    const planId = acceptedPlanId();
    reviewBatch(planId, ['a', 'b']);
    mockParams = { id: planId };
    const text = screenText(await render(<PlanOverviewScreen />));
    expect(text).toContain('Batch 1 is ready');
    expect(text).toContain('Review now');
  });

  it('offers the next batch, practice, and the settings once the plan is in use', async () => {
    const planId = acceptedPlanId();
    acceptBatch(planId, reviewBatch(planId, ['a']));
    mockParams = { id: planId };

    const text = screenText(await render(<PlanOverviewScreen />));
    expect(text).toContain('Write the next batch');
    expect(text).toContain('Practise 1 question');
    expect(text).toContain('Review each batch');
    expect(text).toContain('Write questions for new notes');
    expect(text).toContain('History');
  });

  it('points out notes that turned up after the plan was agreed', async () => {
    const planId = acceptedPlanId();
    acceptBatch(planId, reviewBatch(planId, ['a']));
    baselinePlan(planId, [
      { sourceId: SOURCE.id, path: 'Books/Thinking Fast and Slow 1 Characters.md', contentHash: 'hash:Books/Thinking Fast and Slow 1 Characters.md', title: '' },
    ]);
    mockParams = { id: planId };

    const text = screenText(await render(<PlanOverviewScreen />));
    expect(text).toContain('1 new note for this plan');
    expect(text).toContain('Thinking Fast and Slow 2 Attention');
    expect(text).toContain('Write questions for them');
  });

  it('leads a plan nobody has accepted back to the conversation', async () => {
    const plan = createPlan('TFAS');
    mockParams = { id: plan.id };
    const tree = await render(<PlanOverviewScreen />);
    expect(screenText(tree)).toContain('Finish the plan');
    await press(tree, 'Continue planning');
    expect(mockRouter.push).toHaveBeenCalledWith(`/builder/${plan.id}/chat`);
  });
});

describe('editing a plan', () => {
  it('shows the plan’s fields and the notes it matches, live', async () => {
    mockParams = { id: acceptedPlanId() };
    const tree = await render(<EditPlanScreen />);
    const text = screenText(tree);
    expect(text).toContain('Notes · 2 in this plan');
    expect(text).toContain('Thinking Fast and Slow 1 Characters');
    expect(text).not.toContain('Left out by hand');

    await act(async () => {
      tree.root
        .findAll((node) => node.props.accessibilityLabel === 'Thinking Fast and Slow 1 Characters')[0]
        .props.onPress();
    });
    expect(screenText(tree)).toContain('Notes · 1 in this plan');
    expect(screenText(tree)).toContain('Left out by hand · 1');
  });

  it('saves an edit as a new accepted version', async () => {
    const planId = acceptedPlanId();
    mockParams = { id: planId };
    const tree = await render(<EditPlanScreen />);
    await act(async () => {
      tree.root
        .findAll((node) => node.props.accessibilityLabel === 'Thinking Fast and Slow 2 Attention')[0]
        .props.onPress();
    });
    await press(tree, 'Save');
    expect(getPlan(planId)!.accepted).toMatchObject({ version: 2, author: 'user' });
    expect(getPlan(planId)!.accepted?.scope.exclude).toEqual([
      'github-repo:1:Books/Thinking Fast and Slow 2 Attention.md',
    ]);
  });
});

describe('editing a draft', () => {
  it('opens the draft in the format’s own editor', async () => {
    const planId = acceptedPlanId();
    reviewBatch(planId, ['a']);
    mockParams = { id: planId, questionId: 'a' };

    const text = screenText(await render(<EditDraftScreen />));
    expect(text).toContain('Draft');
    expect(text).toContain('Preview');
    expect(text).toContain('What does chapter a argue?');
  });

  it('says so when the draft has gone', async () => {
    mockParams = { id: acceptedPlanId(), questionId: 'missing' };
    expect(screenText(await render(<EditDraftScreen />))).toContain('Question not found');
  });
});

describe('plans elsewhere in the app', () => {
  /*
    The point of tagging questions with their plan: "show me what this plan
    made" is one tap from the plan, and one chip in the bank.
  */
  it('lands the bank on one plan’s questions, named by the plan', async () => {
    const planId = acceptedPlanId();
    acceptBatch(planId, reviewBatch(planId, ['a']));
    addQuestions([draft('outside', 'A question no plan wrote?')]);
    mockParams = { plan: planId };

    const text = screenText(await render(<QuestionBankScreen />));
    expect(text).toContain('What does chapter a argue?');
    expect(text).not.toContain('A question no plan wrote?');
    expect(text).toContain('Thinking Fast and Slow — big ideas');
    expect(text).toContain('1 of 2 questions');
  });

  it('links a plan’s question back to its plan', async () => {
    const planId = acceptedPlanId();
    acceptBatch(planId, reviewBatch(planId, ['a']));
    mockParams = { id: 'a' };

    const tree = await render(<QuestionDetailScreen />);
    expect(screenText(tree)).toContain('From a quiz plan');
    await press(tree, 'Open the plan');
    expect(mockRouter.push).toHaveBeenCalledWith(`/builder/${planId}`);
  });

  it('describes a plan’s quiz by the plan’s name', async () => {
    const planId = acceptedPlanId();
    acceptBatch(planId, reviewBatch(planId, ['a']));
    const text = screenText(await render(<QuizzesScreen />));
    expect(text).toContain('Plan: Thinking Fast and Slow — big ideas');
  });
});
