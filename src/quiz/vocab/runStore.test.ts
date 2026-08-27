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
  resolveCredentialsOrNull: jest.fn(),
}));

import { AppError } from '../../lib/errors';
import { resolveCredentialsOrNull } from '../../features/llm/credentials';
import { getLlmProvider } from '../../features/llm/registry';
import type { CompletionInput, CompletionResult } from '../../features/llm/types';
import { clearQuestionBank, getQuestions } from '../store';
import { addWord, getVocabWord, vocabStore } from './store';
import { startVocabRun, vocabRunStore } from './runStore';

const resolve = resolveCredentialsOrNull as jest.MockedFunction<typeof resolveCredentialsOrNull>;

type Responder = (input: CompletionInput, index: number) => Partial<CompletionResult> | Error;

/** A provider whose reply depends on which word it was asked about. */
function useProvider(responder: Responder) {
  let index = 0;
  resolve.mockResolvedValue({
    provider: {
      ...getLlmProvider('anthropic'),
      async complete(input) {
        const outcome = responder(input, index);
        index += 1;
        if (outcome instanceof Error) throw outcome;
        return {
          text: '',
          stopReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 20 },
          ...outcome,
        };
      },
    },
    apiKey: 'sk-test',
    model: 'claude-sonnet-5',
  });
}

function reply(word: string): string {
  return JSON.stringify({
    definition: `what ${word} means`,
    partOfSpeech: 'adjective',
    questions: [
      {
        format: 'multiple-choice',
        prompt: `What does "${word}" mean?`,
        explanation: 'Because.',
        difficulty: 'core',
        choices: [`what ${word} means`, 'something else', 'a third thing'],
        correctIndex: 0,
      },
    ],
  });
}

/** The word under test, taken from the prompt the provider was handed. */
function wordIn(input: CompletionInput): string {
  return /Word: (.+)/.exec(input.user)?.[1] ?? '';
}

beforeEach(() => {
  jest.clearAllMocks();
  vocabStore.set({ words: {} });
  vocabRunStore.set({
    status: 'idle',
    words: [],
    added: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  clearQuestionBank();
});

function seed(...words: string[]): string[] {
  return words.map((word) => addWord({ word, addedBy: 'user' }).slug);
}

describe('startVocabRun', () => {
  it('writes questions for every word and reports what it added', async () => {
    useProvider((input) => ({ text: reply(wordIn(input)) }));
    await startVocabRun(seed('laconic', 'perfunctory'));

    const state = vocabRunStore.get();
    expect(state.status).toBe('finished');
    expect(state.added).toBe(2);
    expect(state.words.every((word) => word.status === 'done')).toBe(true);
    expect(getQuestions()).toHaveLength(2);
  });

  it('stores the sense the model wrote the questions against', async () => {
    useProvider((input) => ({ text: reply(wordIn(input)) }));
    await startVocabRun(seed('laconic'));

    expect(getVocabWord('laconic')).toMatchObject({
      definition: 'what laconic means',
      partOfSpeech: 'adjective',
      lastGeneratedAt: expect.any(Number),
    });
  });

  it('adds up what the batch cost, so the price is visible', async () => {
    useProvider((input) => ({ text: reply(wordIn(input)) }));
    await startVocabRun(seed('laconic', 'perfunctory'));

    expect(vocabRunStore.get().usage).toEqual({ inputTokens: 20, outputTokens: 40 });
  });

  /*
    Questions are ingested per word rather than at the end, so a batch that
    breaks partway keeps everything already paid for. The alternative loses real
    money on every failure.
  */
  it('keeps the words that succeeded when one of them fails', async () => {
    useProvider((input) => {
      const word = wordIn(input);
      if (word === 'perfunctory') return new Error('network died');
      return { text: reply(word) };
    });
    await startVocabRun(seed('laconic', 'perfunctory', 'sinecure'));

    const state = vocabRunStore.get();
    expect(state.added).toBe(2);
    expect(state.words.find((word) => word.key === 'perfunctory')?.status).toBe('failed');
    expect(getVocabWord('perfunctory')?.lastError).toBeTruthy();
  });

  it('records a failure against the word so it can be retried knowingly', async () => {
    useProvider(() => new Error('network died'));
    await startVocabRun(seed('laconic'));

    expect(getVocabWord('laconic')?.lastError).toBeTruthy();
    expect(getVocabWord('laconic')?.lastGeneratedAt).toBeUndefined();
  });

  /*
    Every remaining word would fail identically, so continuing pays for the same
    rejection once per word. It has to surface as an error rather than as a
    batch that quietly ended early.
  */
  it('stops the whole batch on an auth failure rather than paying for it ten times', async () => {
    let calls = 0;
    resolve.mockResolvedValue({
      provider: {
        ...getLlmProvider('anthropic'),
        async complete() {
          calls += 1;
          throw new AppError('llm_unauthorized');
        },
      },
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
    });

    await startVocabRun(seed('laconic', 'perfunctory', 'sinecure'));

    expect(calls).toBeLessThan(3);
    expect(vocabRunStore.get().error).toBeTruthy();
  });

  it('marks a word the model does not recognise, rather than inventing questions', async () => {
    useProvider(() => ({
      text: JSON.stringify({ unknown: true, definition: 'no idea', questions: [] }),
    }));
    await startVocabRun(seed('qwertyuiop'));

    expect(vocabRunStore.get().words[0].status).toBe('failed');
    expect(getQuestions()).toHaveLength(0);
    expect(getVocabWord('qwertyuiop')?.lastError).toBeTruthy();
  });

  /*
    The words are already saved and still worth keeping, so this settles as a
    finished batch with a reason on each word — not as a thrown error that
    would look like the words failed to save.
  */
  it('skips every word without throwing when no model is configured', async () => {
    resolve.mockResolvedValue(null);
    await startVocabRun(seed('laconic', 'perfunctory'));

    const state = vocabRunStore.get();
    expect(state.status).toBe('finished');
    expect(state.words.every((word) => word.status === 'skipped')).toBe(true);
    expect(getVocabWord('laconic')?.lastError).toBe('No model configured.');
  });

  it('tells the model what it already asked, so a second run adds new angles', async () => {
    const seen: string[] = [];
    useProvider((input) => {
      seen.push(input.user);
      return { text: reply(wordIn(input)) };
    });

    const slugs = seed('laconic');
    await startVocabRun(slugs);
    await startVocabRun(slugs);

    expect(seen[0]).not.toContain('Do not ask any of them again');
    expect(seen[1]).toContain('Do not ask any of them again');
    expect(seen[1]).toContain('What does "laconic" mean?');
  });

  /*
    Ids are deterministic, so the second run's identical question collides with
    the first and `addQuestions` keeps the original — which is what stops the
    SRS scheduling two copies of the same card.
  */
  it('does not double the bank when the same word is run twice', async () => {
    useProvider((input) => ({ text: reply(wordIn(input)) }));
    const slugs = seed('laconic');

    await startVocabRun(slugs);
    await startVocabRun(slugs);

    expect(getQuestions()).toHaveLength(1);
  });

  it('ignores a word that was removed between queueing and running', async () => {
    useProvider((input) => ({ text: reply(wordIn(input)) }));
    await startVocabRun(['never-added']);

    expect(vocabRunStore.get().words[0].status).toBe('skipped');
  });

  it('does nothing at all when given no words', async () => {
    await startVocabRun([]);
    expect(vocabRunStore.get().status).toBe('idle');
  });
});
