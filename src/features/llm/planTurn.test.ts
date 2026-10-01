import { emptyScope, type PlanSpec } from '../../quiz/builder/types';
import type { LlmProviderDefinition } from './contract';
import { parsePlannerReply, runPlannerTurn } from './planTurn';
import { buildPlannerSystemPrompt, buildPlannerUserPrompt, describeMatch, formatTranscript } from './planPrompt';
import { getLlmProvider } from './registry';
import type { CompletionInput, CompletionResult } from './types';

const NOW = 1_760_000_000_000;

function fakeProvider(text: string, stopReason: CompletionResult['stopReason'] = 'stop') {
  const calls: CompletionInput[] = [];
  const provider: LlmProviderDefinition = {
    ...getLlmProvider('anthropic'),
    async complete(input) {
      calls.push(input);
      return { text, stopReason, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
  return { provider, calls };
}

const PLAN = {
  title: 'TFAS — the big ideas',
  summary: 'The two systems and the biases they cause.',
  scope: { terms: ['Thinking Fast and Slow'], excludeTerms: [], folders: [] },
  focus: ['How System 1 and System 2 differ'],
  avoid: ['Experiment sample sizes'],
  formats: [],
  difficulty: 'mixed',
  questionsPerNote: 5,
  style: '',
};

function previous(): PlanSpec {
  return {
    version: 3,
    title: PLAN.title,
    summary: PLAN.summary,
    scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
    focus: [...PLAN.focus],
    avoid: [...PLAN.avoid],
    formats: [],
    difficulty: 'mixed',
    questionsPerNote: 5,
    style: '',
    author: 'ai',
    updatedAt: NOW - 1,
  };
}

function turn(text: string, overrides: Partial<Parameters<typeof runPlannerTurn>[0]> = {}) {
  const { provider, calls } = fakeProvider(text);
  return {
    calls,
    result: runPlannerTurn({
      catalog: '38 notes in total.',
      plan: null,
      match: null,
      transcript: [{ role: 'user', text: 'Quiz me on Thinking Fast and Slow' }],
      previous: null,
      provider,
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      now: NOW,
      ...overrides,
    }),
  };
}

describe('runPlannerTurn', () => {
  it('returns the reply, a first plan, and what it cost', async () => {
    const outcome = await turn(JSON.stringify({ reply: 'Here is a plan.', plan: PLAN, ready: true })).result;
    expect(outcome.reply).toBe('Here is a plan.');
    expect(outcome.spec).toMatchObject({ version: 1, title: PLAN.title, author: 'ai' });
    expect(outcome.ready).toBe(true);
    expect(outcome.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('sends the planner prompt as JSON at the cheaper reasoning setting', async () => {
    const { calls, result } = turn(JSON.stringify({ reply: 'ok', plan: PLAN }));
    await result;
    expect(calls[0].system).toBe(buildPlannerSystemPrompt());
    expect(calls[0].json).toBe(true);
    expect(calls[0].effort).toBe('low');
  });

  it('reports usage even for a reply it cannot use', async () => {
    const onUsage = jest.fn();
    await expect(turn('', { onUsage }).result).rejects.toThrow(/empty/);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50 });
  });

  it('names a truncated reply as truncated', async () => {
    const { provider } = fakeProvider('{"reply":"Here is', 'length');
    await expect(
      runPlannerTurn({
        catalog: null,
        plan: null,
        match: null,
        transcript: [],
        previous: null,
        provider,
        apiKey: 'sk-test',
        model: 'claude-sonnet-5',
      }),
    ).rejects.toThrow(/cut off/);
  });

  it('refuses with no key before spending anything', async () => {
    const { calls, result } = turn('{}', { apiKey: '' });
    await expect(result).rejects.toMatchObject({ code: 'llm_not_configured' });
    expect(calls).toHaveLength(0);
  });
});

describe('parsePlannerReply', () => {
  it('keeps the previous plan object when the reply changed nothing', () => {
    const before = previous();
    const parsed = parsePlannerReply(JSON.stringify({ reply: 'Same plan.', plan: PLAN }), before, NOW);
    expect(parsed?.spec).toBe(before);
  });

  it('bumps the version when the reply changed something', () => {
    const parsed = parsePlannerReply(
      JSON.stringify({ reply: 'Harder now.', plan: { ...PLAN, difficulty: 'challenging' } }),
      previous(),
      NOW,
    );
    expect(parsed?.spec).toMatchObject({ version: 4, difficulty: 'challenging' });
  });

  /*
    A model that ignores the JSON instruction has still said something worth
    reading. Throwing it away would make the reader pay for a retry to get a
    reply they already have.
  */
  it('shows a plain-prose reply as it is, with the plan untouched', () => {
    const before = previous();
    const parsed = parsePlannerReply('Sure — should I include the conclusion chapter?', before, NOW);
    expect(parsed).toEqual({ reply: 'Sure — should I include the conclusion chapter?', spec: before, ready: false });
  });

  it('reads a plan written at the root rather than under "plan"', () => {
    const parsed = parsePlannerReply(JSON.stringify({ reply: 'Plan below.', ...PLAN }), null, NOW);
    expect(parsed?.spec?.title).toBe(PLAN.title);
  });

  it('reads a fenced reply', () => {
    const parsed = parsePlannerReply(`\`\`\`json\n${JSON.stringify({ reply: 'Fenced.', plan: PLAN })}\n\`\`\``, null, NOW);
    expect(parsed?.reply).toBe('Fenced.');
  });

  it('supplies words when the model sent a plan but no reply', () => {
    expect(parsePlannerReply(JSON.stringify({ plan: PLAN }), null, NOW)?.reply).toMatch(/updated the plan/);
  });

  it('is null for a reply with nothing in it', () => {
    expect(parsePlannerReply('', null, NOW)).toBeNull();
    expect(parsePlannerReply('{"ready": true}', previous(), NOW)).toBeNull();
  });
});

describe('the planner prompts', () => {
  it('tells the planner not to repeat what the writer already knows', () => {
    expect(buildPlannerSystemPrompt()).toMatch(/WRITER ALREADY KNOWS/);
  });

  it('asks for a complete plan straight away, and at most two questions', () => {
    const prompt = buildPlannerSystemPrompt();
    expect(prompt).toMatch(/complete plan straight away/);
    expect(prompt).toMatch(/at most two/);
  });

  it('documents every field the sanitizer reads', () => {
    const prompt = buildPlannerSystemPrompt();
    for (const field of ['"reply"', '"plan"', '"terms"', '"excludeTerms"', '"folders"', '"focus"', '"avoid"', '"formats"', '"difficulty"', '"questionsPerNote"', '"style"', '"ready"']) {
      expect(prompt).toContain(field);
    }
  });

  /*
    The match report is the only way the planner can learn its scope matched
    nothing — so a scope matching zero notes is said in capitals, with an
    instruction, rather than as a quiet "0".
  */
  it('says loudly when the scope matches nothing', () => {
    expect(describeMatch({ count: 0, total: 75, sample: [] })).toMatch(/NONE of their 75 notes/);
    expect(describeMatch({ count: 38, total: 75, sample: ['TFAS 1', 'TFAS 2'] })).toBe(
      "The plan's scope matches 38 of their 75 notes: TFAS 1; TFAS 2; …",
    );
    expect(describeMatch(null)).toMatch(/could not be listed/);
  });

  it('includes the catalogue, the plan, its match and the conversation', () => {
    const prompt = buildPlannerUserPrompt({
      catalog: 'CATALOGUE HERE',
      plan: { title: 'TFAS' },
      match: { count: 2, total: 9, sample: ['a', 'b'] },
      transcript: [
        { role: 'user', text: 'Quiz me on TFAS' },
        { role: 'assistant', text: 'Here is a plan.' },
        { role: 'event', text: 'Batch 1: you kept 9.' },
        { role: 'user', text: 'Too easy.', feedback: true },
      ],
    });
    expect(prompt).toContain('CATALOGUE HERE');
    expect(prompt).toContain('{"title":"TFAS"}');
    expect(prompt).toContain('matches 2 of their 9 notes');
    expect(prompt).toContain('READER: Quiz me on TFAS');
    expect(prompt).toContain('YOU: Here is a plan.');
    expect(prompt).toContain('APP: Batch 1: you kept 9.');
    expect(prompt).toContain('READER (review feedback): Too easy.');
  });

  it('sends what the reader first asked for, whatever survives of the conversation', () => {
    const prompt = buildPlannerUserPrompt({
      request: 'Quiz me on Thinking Fast and Slow — big ideas only',
      catalog: null,
      plan: null,
      match: null,
      transcript: [{ role: 'event', text: 'You accepted plan v7.' }],
    });
    expect(prompt.startsWith('WHAT THEY FIRST ASKED FOR\nQuiz me on Thinking Fast and Slow — big ideas only')).toBe(true);
  });

  it('asks for a first plan when there is none yet', () => {
    expect(buildPlannerUserPrompt({ catalog: null, plan: null, match: null, transcript: [] })).toMatch(
      /No plan yet — propose a complete one/,
    );
  });
});

describe('formatTranscript', () => {
  it('keeps the opening request however long the conversation gets', () => {
    const entries = [
      { role: 'user' as const, text: 'THE OPENING REQUEST' },
      ...Array.from({ length: 60 }, (_, index) => ({ role: 'assistant' as const, text: `reply ${index}` })),
    ];
    const text = formatTranscript(entries);
    expect(text.startsWith('READER: THE OPENING REQUEST')).toBe(true);
    expect(text).toContain('reply 59');
    expect(text).not.toContain('reply 0\n');
    expect(text).toMatch(/earlier messages omitted/);
  });

  it('always includes the latest message, even an enormous one', () => {
    const text = formatTranscript([
      { role: 'user', text: 'start' },
      { role: 'user', text: 'x'.repeat(20_000) },
    ]);
    expect(text).toContain('x'.repeat(20_000));
  });
});
