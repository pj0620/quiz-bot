import { AppError } from '../../lib/errors';
import { parseNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import { CIVIL_WAR } from '../../notes/__fixtures__/sampleNotes';
import type { LlmProviderDefinition } from './contract';
import { generateNoteInParts } from './generateNoteInParts';
import { getLlmProvider } from './registry';
import type { CompletionInput, CompletionResult } from './types';

/** Long enough to be split into several parts. */
function bigNote(sections: number, sentences: number) {
  const body = Array.from({ length: sections }, (_, index) => {
    const line = `Section ${index} states a fact that is well worth remembering later on. `;
    return `## Heading ${index}\n\n${line.repeat(sentences)}`;
  }).join('\n\n');
  return parseNote(body, 'Big Note');
}

const smallNote = parseNote(CIVIL_WAR.content, noteStem(CIVIL_WAR.path));

/** One distinct question per reply, so ids differ between parts. */
function reply(tag: string, count = 2): string {
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      format: 'true-false',
      // Both halves carry the tag, since which one is shown — and so which one
      // reaches the next part's "already asked" list — is the parser's choice.
      claim: `Claim ${tag}-${i} about the material in this note holds.`,
      distortion: `Claim ${tag}-${i} about the material in this note fails.`,
      explanation: 'Because the notes say so.',
    })),
  });
}

type Responder = (input: CompletionInput, index: number) => Partial<CompletionResult> | Error;

function fakeProvider(responder: Responder) {
  const calls: CompletionInput[] = [];
  const base = getLlmProvider('anthropic');
  const provider: LlmProviderDefinition = {
    ...base,
    async complete(input) {
      const index = calls.length;
      calls.push(input);
      const outcome = responder(input, index);
      if (outcome instanceof Error) throw outcome;
      return {
        text: outcome.text ?? reply(String(index)),
        stopReason: outcome.stopReason ?? 'stop',
        usage: outcome.usage ?? { inputTokens: 100, outputTokens: 200 },
      } as CompletionResult;
    },
  };
  return { provider, calls };
}

function run(note: ReturnType<typeof parseNote>, responder: Responder, signal?: AbortSignal) {
  const { provider, calls } = fakeProvider(responder);
  return {
    calls,
    promise: generateNoteInParts({
      note,
      path: CIVIL_WAR.path,
      sourceId: 'src-1',
      provider,
      apiKey: 'sk-test',
      model: 'test-model',
      now: 1_760_000_000_000,
      signal,
    }),
  };
}

describe('one note, several requests', () => {
  it('sends a single request for an ordinary note', () => {
    const { calls, promise } = run(smallNote, () => ({}));
    return promise.then((result) => {
      expect(calls).toHaveLength(1);
      expect(result.modelCalls).toBe(1);
    });
  });

  it('splits a long note and sums what came back', async () => {
    const { calls, promise } = run(bigNote(12, 12), (_input, index) => ({ text: reply(`p${index}`) }));
    const result = await promise;

    expect(calls.length).toBeGreaterThan(1);
    expect(result.modelCalls).toBe(calls.length);
    expect(result.questions.length).toBe(calls.length * 2);
    expect(result.usage.inputTokens).toBe(calls.length * 100);
    expect(result.usage.outputTokens).toBe(calls.length * 200);
  });

  it('tells every part where it sits in the whole note', async () => {
    const { calls, promise } = run(bigNote(12, 12), (_input, index) => ({ text: reply(`p${index}`) }));
    await promise;

    for (const call of calls) {
      expect(call.user).toContain('Sections in the whole note');
      expect(call.user).toContain('History of America 40 First Year of Fighting.md');
    }
    expect(calls[1].user).toContain('This is part 2 of');
  });

  it('tells later parts what earlier parts already asked', async () => {
    const { calls, promise } = run(bigNote(12, 12), (_input, index) => ({ text: reply(`p${index}`) }));
    await promise;
    expect(calls[1].user).toContain('Claim p0-0');
  });

  it('counts a question once when two parts word it identically', async () => {
    // Ids hash the prompt text, so the bank would store one. Counting two here
    // would over-report what the run actually produced.
    const { promise } = run(bigNote(12, 12), () => ({ text: reply('same') }));
    const result = await promise;
    expect(result.questions).toHaveLength(2);
  });
});

describe('when a part fails', () => {
  it('keeps the questions the other parts produced', async () => {
    const { promise } = run(bigNote(12, 12), (_input, index) =>
      index === 0 ? new AppError('llm_bad_response') : { text: reply(`p${index}`) },
    );
    const result = await promise;

    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.failedParts).toBe(1);
  });

  it('fails the note only when nothing at all came back', async () => {
    const { promise } = run(bigNote(12, 12), () => new AppError('llm_bad_response'));
    await expect(promise).rejects.toMatchObject({ code: 'llm_bad_response' });
  });

  it('stops immediately on a problem that would repeat for every part', async () => {
    // A missing or rejected key fails identically every time; continuing would
    // spend a request per part to learn the same thing.
    const { calls, promise } = run(bigNote(12, 12), () => new AppError('llm_unauthorized'));
    await expect(promise).rejects.toMatchObject({ code: 'llm_unauthorized' });
    expect(calls).toHaveLength(1);
  });

  it('still reports the tokens a failed part cost', async () => {
    const { promise } = run(bigNote(12, 12), (_input, index) =>
      index === 0 ? { text: 'not json at all' } : { text: reply(`p${index}`) },
    );
    const result = await promise;

    // The unusable reply was billed like any other.
    expect(result.usage.outputTokens).toBe(result.modelCalls * 200);
  });
});

describe('cancelling', () => {
  it('keeps completed parts instead of throwing them away', async () => {
    const controller = new AbortController();
    const { promise } = run(
      bigNote(12, 12),
      (_input, index) => {
        if (index === 0) controller.abort();
        return { text: reply(`p${index}`) };
      },
      controller.signal,
    );

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.modelCalls).toBe(1);
  });
});

describe('a note with nothing to ask about', () => {
  it('sends no request at all', async () => {
    const note = parseNote('![[Pasted image 1.png]]\n\n![[Pasted image 2.png]]', 'Screenshots');
    const { calls, promise } = run(note, () => ({}));
    const result = await promise;

    expect(calls).toHaveLength(0);
    expect(result.questions).toEqual([]);
    expect(result.modelCalls).toBe(0);
  });
});
