import { AppError } from '../../lib/errors';
import type { ListRecallQuestion, ShortAnswerQuestion } from '../../quiz/types';
import { JUDGE_TIMEOUT_MS, type LlmProviderDefinition } from './contract';
import { gradeListRecall } from './gradeListRecall';
import { gradeShortAnswer } from './gradeShortAnswer';
import type { CompletionInput, CompletionResult } from './types';

/**
 * How marking behaves on a bad connection.
 *
 * The provider is faked at the `complete` seam, which is where the timeout and
 * retry choices are handed over, so these tests see exactly what the provider
 * would be asked to do without touching fetch.
 */

const base = {
  id: 'q1',
  prompt: 'Which system does priming operate in?',
  explanation: 'Because.',
  topics: [],
  difficulty: 'core',
  sourceId: 'src-1',
  provenance: { sourceId: 'src-1', path: 'a.md' },
  addedAt: 0,
};

const shortAnswer = { ...base, format: 'short-answer', modelAnswer: 'System 1' } as ShortAnswerQuestion;
const listRecall = {
  ...base,
  format: 'list-recall',
  required: 2,
  items: ['Soviet Union', 'United States'],
} as ListRecallQuestion;

function fakeProvider(complete: (input: CompletionInput) => Promise<CompletionResult>): LlmProviderDefinition {
  return {
    id: 'openai',
    label: 'Fake',
    icon: 'flash-outline',
    consoleUrl: '',
    keyPrefix: '',
    keyHint: '',
    models: [],
    defaultModel: 'fake',
    buildRequest: () => ({ url: '', headers: {}, body: '' }),
    parseResponse: () => ({ text: '', stopReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 } }),
    complete,
  };
}

function reply(text: string): CompletionResult {
  return { text, stopReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 } };
}

describe('marking on a slow or absent connection', () => {
  it('asks for the short judge timeout and no transport retries', async () => {
    const seen: CompletionInput[] = [];
    const provider = fakeProvider(async (input) => {
      seen.push(input);
      return reply('{"verdict":"correct"}');
    });

    await gradeShortAnswer({ question: shortAnswer, text: 'the fast one', provider, apiKey: 'k', model: 'm' });
    await gradeListRecall({ question: listRecall, entries: ['USSR'], provider, apiKey: 'k', model: 'm' });

    expect(seen).toHaveLength(2);
    for (const input of seen) {
      expect(input.timeoutMs).toBe(JUDGE_TIMEOUT_MS);
      expect(input.retries).toBe(0);
    }
  });

  it('keeps the judge timeout well under the generation one', () => {
    // The whole point: a slow connection is given up on, not waited out.
    expect(JUDGE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('falls back (null) when the connection is too slow to answer', async () => {
    const provider = fakeProvider(async () => {
      throw new AppError('timeout');
    });
    await expect(
      gradeShortAnswer({ question: shortAnswer, text: 'the fast one', provider, apiKey: 'k', model: 'm' }),
    ).resolves.toBeNull();
    await expect(
      gradeListRecall({ question: listRecall, entries: ['USSR'], provider, apiKey: 'k', model: 'm' }),
    ).resolves.toBeNull();
  });

  it('falls back (null) when offline', async () => {
    const provider = fakeProvider(async () => {
      throw new AppError('offline');
    });
    await expect(
      gradeShortAnswer({ question: shortAnswer, text: 'the fast one', provider, apiKey: 'k', model: 'm' }),
    ).resolves.toBeNull();
  });
});
