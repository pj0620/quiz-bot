import { parseNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import { CIVIL_WAR } from '../../notes/__fixtures__/sampleNotes';
import type { LlmProviderDefinition } from './contract';
import { generateFromNote } from './generateFromNote';
import { getLlmProvider } from './registry';
import type { CompletionInput, CompletionResult, StopReason } from './types';

const note = parseNote(CIVIL_WAR.content, noteStem(CIVIL_WAR.path));

function reply(count: number): string {
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      format: 'true-false',
      prompt: `A claim about the border states, number ${i}.`,
      explanation: 'Because the notes say so.',
      correct: true,
    })),
  });
}

/** Captures what the provider was asked for, without touching the network. */
function fakeProvider(result: Partial<CompletionResult>): {
  provider: LlmProviderDefinition;
  calls: CompletionInput[];
} {
  const calls: CompletionInput[] = [];
  const base = getLlmProvider('anthropic');
  const provider: LlmProviderDefinition = {
    ...base,
    async complete(input) {
      calls.push(input);
      return {
        text: result.text ?? reply(3),
        stopReason: (result.stopReason ?? 'stop') as StopReason,
        usage: result.usage ?? { inputTokens: 100, outputTokens: 200 },
      };
    },
  };
  return { provider, calls };
}

function run(result: Partial<CompletionResult>, count = 5) {
  const { provider, calls } = fakeProvider(result);
  return {
    calls,
    promise: generateFromNote({
      note,
      path: CIVIL_WAR.path,
      sourceId: 'src-1',
      provider,
      apiKey: 'sk-test',
      model: 'test-model',
      count,
      now: 1_760_000_000_000,
    }),
  };
}

describe('token budget', () => {
  it('asks for far more output than the JSON alone needs', async () => {
    /*
      The regression this guards is expensive and silent. On a reasoning model
      `maxTokens` covers internal reasoning as well as the reply, so a budget
      sized for the JSON gets spent thinking and returns an EMPTY completion —
      observed at exactly 2000/2000 tokens with zero characters of output.
    */
    const { calls, promise } = run({});
    await promise;
    expect(calls[0].maxTokens).toBeGreaterThanOrEqual(8_000);
  });

  it('scales the budget with the number of questions asked for', async () => {
    const { calls, promise } = run({}, 20);
    await promise;
    expect(calls[0].maxTokens).toBeGreaterThanOrEqual(20 * 1_200);
  });

  it('always asks for JSON', async () => {
    const { calls, promise } = run({});
    await promise;
    expect(calls[0].json).toBe(true);
  });
});

describe('failure reporting', () => {
  it('names the real cause when the budget was spent without any output', async () => {
    // "invalid JSON" would send someone looking in entirely the wrong place.
    const { promise } = run({ text: '', stopReason: 'length' });
    await expect(promise).rejects.toMatchObject({
      code: 'llm_bad_response',
      message: expect.stringContaining('entire output budget'),
    });
  });

  it('distinguishes a truncated reply from an empty one', async () => {
    const { promise } = run({ text: '{"questions":[{"format":"true-', stopReason: 'length' });
    await expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('cut off'),
    });
  });

  it('reports when a reply parsed but yielded nothing usable', async () => {
    const { promise } = run({ text: JSON.stringify({ questions: [{ format: 'essay' }] }) });
    await expect(promise).rejects.toMatchObject({
      code: 'llm_bad_response',
      message: expect.stringContaining('none usable'),
    });
  });

  it('refuses to run without a key', async () => {
    const { provider } = fakeProvider({});
    await expect(
      generateFromNote({
        note,
        path: CIVIL_WAR.path,
        sourceId: 'src-1',
        provider,
        apiKey: '',
        model: 'test-model',
        count: 5,
      }),
    ).rejects.toMatchObject({ code: 'llm_not_configured' });
  });
});

describe('success', () => {
  it('returns questions with provenance and usage', async () => {
    const { promise } = run({ text: reply(3), usage: { inputTokens: 900, outputTokens: 400 } });
    const outcome = await promise;

    expect(outcome.questions).toHaveLength(3);
    expect(outcome.usage).toEqual({ inputTokens: 900, outputTokens: 400 });
    expect(outcome.questions[0].provenance.noteTitle).toBe('First Year of Fighting');
    expect(outcome.questions[0].topics).toContain('history-of-america');
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps the usable questions when some rows were rejected', async () => {
    const mixed = JSON.stringify({
      questions: [
        { format: 'true-false', prompt: 'Good one.', explanation: 'Yes.', correct: true },
        { format: 'essay', prompt: 'Bad one.' },
      ],
    });
    const outcome = await run({ text: mixed }).promise;

    expect(outcome.questions).toHaveLength(1);
    expect(outcome.rejected).toHaveLength(1);
  });
});
