import { parseNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import { CIVIL_WAR } from '../../notes/__fixtures__/sampleNotes';
import type { LlmProviderDefinition } from './contract';
import { generateFromNote, MAX_TOKEN_BUDGET } from './generateFromNote';
import { MAX_QUESTIONS_PER_CALL } from './generateNoteInParts';
import { getLlmProvider } from './registry';
import type { CompletionInput, CompletionResult, StopReason } from './types';

const note = parseNote(CIVIL_WAR.content, noteStem(CIVIL_WAR.path));

function reply(count: number): string {
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      format: 'true-false',
      // The paired shape the prompt asks for; the parser picks which half is
      // shown, so a fixture supplies both and no answer.
      claim: `A claim about the border states, number ${i}, holds.`,
      distortion: `A claim about the border states, number ${i}, fails.`,
      explanation: 'Because the notes say so.',
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
    const { calls, promise } = run({}, 10);
    await promise;
    expect(calls[0].maxTokens).toBeGreaterThan(8_000);
  });

  it('never exceeds the absolute ceiling, whatever it is asked for', async () => {
    /*
      The model id is free text in Settings, so a budget above that model's
      maximum output is an HTTP 400 — not a bigger budget. Every note in the run
      would then fail identically and count towards being permanently skipped.
    */
    for (const count of [10, 30, 500]) {
      const { calls, promise } = run({}, count);
      await promise;
      expect(calls[0].maxTokens).toBeLessThanOrEqual(MAX_TOKEN_BUDGET);
    }
  });

  it('leaves room for a full call’s worth of questions on top of the thinking', async () => {
    /*
      The invariant that keeps the two ceilings honest. `MAX_QUESTIONS_PER_CALL`
      questions must fit inside `MAX_TOKEN_BUDGET` WITH the reasoning headroom
      still intact — otherwise the token cap silently truncates the question cap
      and the reply comes back cut off, which is discarded whole.

      This is what the old numbers got wrong: at 1,600 tokens a question, ten
      questions consumed the entire 16,000 budget and left nothing for thinking,
      so the ceiling could never rise.
    */
    const { calls, promise } = run({}, MAX_QUESTIONS_PER_CALL);
    await promise;
    expect(calls[0].maxTokens).toBe(MAX_TOKEN_BUDGET);

    // A measured question costs ~356 output tokens, so a full call needs well
    // under half the budget and the rest is headroom.
    const forQuestions = MAX_QUESTIONS_PER_CALL * 400;
    expect(MAX_TOKEN_BUDGET - forQuestions).toBeGreaterThanOrEqual(8_000);
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

  it('carries the reader’s own instructions into the system prompt', async () => {
    // The whole point of the Settings field: if it doesn't reach the request,
    // it is a text box that does nothing.
    const { provider, calls } = fakeProvider({});
    await generateFromNote({
      note,
      path: CIVIL_WAR.path,
      sourceId: 'src-1',
      provider,
      apiKey: 'sk-test',
      model: 'test-model',
      count: 5,
      guidance: 'Ask more about people than about dates.',
    });

    expect(calls[0].system).toContain('Ask more about people than about dates.');
  });

  it('sends the plain prompt when no instructions were written', async () => {
    const { calls, promise } = run({});
    await promise;
    expect(calls[0].system).not.toContain('FROM THE READER');
  });

  it('keeps the usable questions when some rows were rejected', async () => {
    const mixed = JSON.stringify({
      questions: [
        { format: 'true-false', claim: 'Good one.', distortion: 'Bad one.', explanation: 'Yes.' },
        { format: 'essay', prompt: 'Bad one.' },
      ],
    });
    const outcome = await run({ text: mixed }).promise;

    expect(outcome.questions).toHaveLength(1);
    expect(outcome.rejected).toHaveLength(1);
  });
});
