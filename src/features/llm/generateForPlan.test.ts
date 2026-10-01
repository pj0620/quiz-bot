import { parseNote } from '../../notes/parse';
import { emptyScope, type PlanSpec } from '../../quiz/builder/types';
import type { LlmProviderDefinition } from './contract';
import { generateForPlan } from './generateForPlan';
import { buildPlanQuestionsUserPrompt } from './planPrompt';
import { getLlmProvider } from './registry';
import type { CompletionInput, CompletionResult } from './types';

const NOW = 1_760_000_000_000;
const PATH = 'Books/Thinking Fast and Slow 11 Anchors.md';

const NOTE = parseNote(
  `# Anchors\n\nAnchoring effect - the first number you see biases later estimates\nSee [[Priming]]\n`,
  'Thinking Fast and Slow 11 Anchors',
);

function spec(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    version: 2,
    title: 'TFAS — big ideas',
    summary: 'The biases.',
    scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
    focus: ['What each bias is and why it happens'],
    avoid: ['Experiment details'],
    formats: [],
    difficulty: 'challenging',
    questionsPerNote: 4,
    style: '',
    author: 'ai',
    updatedAt: NOW,
    ...overrides,
  };
}

const MULTIPLE_CHOICE = {
  format: 'multiple-choice',
  prompt: 'In Thinking Fast and Slow, what is the anchoring effect?',
  explanation: 'An initial number pulls later estimates towards it.',
  difficulty: 'core',
  choices: ['A pull towards a first number', 'Fear of loss', 'Overconfidence'],
  correctIndex: 0,
};

const SHORT_ANSWER = {
  format: 'short-answer',
  prompt: 'Why does an arbitrary number change estimates, according to Kahneman?',
  explanation: 'Priming and insufficient adjustment.',
  difficulty: 'deep',
  modelAnswer: 'System 1 is primed by the number and System 2 adjusts away from it too little.',
};

function fakeProvider(text: string, stopReason: CompletionResult['stopReason'] = 'stop') {
  const calls: CompletionInput[] = [];
  const provider: LlmProviderDefinition = {
    ...getLlmProvider('anthropic'),
    async complete(input) {
      calls.push(input);
      return { text, stopReason, usage: { inputTokens: 11, outputTokens: 22 } };
    },
  };
  return { provider, calls };
}

function run(rows: unknown[], overrides: Partial<Parameters<typeof generateForPlan>[0]> = {}) {
  const { provider, calls } = fakeProvider(JSON.stringify({ questions: rows }));
  return {
    calls,
    result: generateForPlan({
      note: NOTE,
      path: PATH,
      sourceId: 'github-repo:1',
      planId: 'plan-1',
      spec: spec(),
      count: 4,
      provider,
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      now: NOW,
      ...overrides,
    }),
  };
}

describe('generateForPlan', () => {
  it('stamps every question with the plan and note provenance', async () => {
    const outcome = await run([MULTIPLE_CHOICE, SHORT_ANSWER]).result;
    expect(outcome.questions).toHaveLength(2);
    for (const question of outcome.questions) {
      expect(question.planId).toBe('plan-1');
      expect(question.sourceId).toBe('github-repo:1');
      expect(question.provenance.path).toBe(PATH);
    }
    expect(outcome.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
  });

  /*
    The plan rides as the reader's guidance — last in the system prompt, and
    explicitly outranking the built-in rules — so every rule that makes a note
    question worth asking still applies underneath it.
  */
  it('puts the plan in the system prompt as the reader’s guidance, under the usual rules', async () => {
    const { calls, result } = run([MULTIPLE_CHOICE], { guidance: 'I prefer plain words.' });
    await result;
    const system = calls[0].system;
    expect(system).toContain('THE FIVE-YEAR TEST');
    expect(system).toContain('FROM THE READER');
    expect(system).toContain('- What each bias is and why it happens');
    expect(system).toContain('- Experiment details');
    expect(system.indexOf('THIS QUIZ HAS A PLAN')).toBeLessThan(system.indexOf('I prefer plain words.'));
  });

  it('asks for the plan’s count and shows the note verbatim', async () => {
    const { calls, result } = run([MULTIPLE_CHOICE]);
    await result;
    expect(calls[0].user).toContain('File: Thinking Fast and Slow 11 Anchors.md');
    expect(calls[0].user).toContain('Write 4 questions from this note');
  });

  it('drops formats the plan rules out', async () => {
    const outcome = await run([MULTIPLE_CHOICE, SHORT_ANSWER], {
      spec: spec({ formats: ['multiple-choice'] }),
    }).result;
    expect(outcome.questions.map((question) => question.format)).toEqual(['multiple-choice']);
    expect(outcome.offPlan).toBe(1);
  });

  it('fails a reply that held only formats the plan rules out, so the note is retried', async () => {
    await expect(run([SHORT_ANSWER], { spec: spec({ formats: ['multiple-choice'] }) }).result).rejects.toThrow(
      /formats this plan doesn't allow/,
    );
  });

  /*
    "Nothing here fits the plan" is an honest answer, not a failure. Treating
    it as one would retry the note on every batch until it was given up on.
  */
  it('returns an honest empty answer as empty, not as a failure', async () => {
    const outcome = await run([]).result;
    expect(outcome.questions).toEqual([]);
  });

  it('fails a reply whose rows were all unusable', async () => {
    await expect(run([{ format: 'multiple-choice', prompt: 'No choices?' }]).result).rejects.toThrow(/none usable/);
  });

  it('names a truncated reply as truncated', async () => {
    const { provider } = fakeProvider('{"questions":[', 'length');
    await expect(
      generateForPlan({
        note: NOTE,
        path: PATH,
        sourceId: 'github-repo:1',
        planId: 'plan-1',
        spec: spec(),
        count: 4,
        provider,
        apiKey: 'sk-test',
        model: 'claude-sonnet-5',
      }),
    ).rejects.toThrow(/cut off/);
  });
});

describe('buildPlanQuestionsUserPrompt', () => {
  it('lists what the quiz already has from the note, so a later pass asks something new', () => {
    const prompt = buildPlanQuestionsUserPrompt({
      note: NOTE,
      filename: 'x.md',
      count: 3,
      alreadyAsked: ['What is anchoring?'],
    });
    expect(prompt).toContain('This quiz already has these questions from this note');
    expect(prompt).toContain('- What is anchoring?');
  });

  it('says nothing about earlier questions when there are none', () => {
    expect(buildPlanQuestionsUserPrompt({ note: NOTE, filename: 'x.md', count: 1 })).not.toContain(
      'already has these questions',
    );
  });

  it('writes the singular for a single question', () => {
    expect(buildPlanQuestionsUserPrompt({ note: NOTE, filename: 'x.md', count: 1 })).toContain('Write 1 question from');
  });
});
