import type { CompletionInput, CompletionResult } from './types';
import type { LlmProviderDefinition } from './contract';
import { getLlmProvider } from './registry';
import { parseSuggestions, suggestVocabWords } from './suggestVocabWords';

function fakeProvider(text: string, stopReason: CompletionResult['stopReason'] = 'stop') {
  const calls: CompletionInput[] = [];
  const provider: LlmProviderDefinition = {
    ...getLlmProvider('anthropic'),
    async complete(input) {
      calls.push(input);
      return { text, stopReason, usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
  return { provider, calls };
}

const WORDS = JSON.stringify({
  words: [
    { word: 'perfunctory', definition: 'done without care, as a formality', partOfSpeech: 'adjective' },
    { word: 'sinecure', definition: 'a job that pays but requires little work', partOfSpeech: 'noun' },
  ],
});

function run(text: string, overrides: Record<string, unknown> = {}) {
  const { provider, calls } = fakeProvider(text);
  return {
    calls,
    result: suggestVocabWords({
      count: 5,
      avoid: [],
      provider,
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      ...overrides,
    }),
  };
}

describe('parseSuggestions', () => {
  it('reads a list of words with their definitions', () => {
    expect(parseSuggestions(WORDS)).toHaveLength(2);
  });

  it('accepts a bare array, which is what a model returns half the time', () => {
    expect(parseSuggestions('[{"word":"elide","definition":"to leave out"}]')).toHaveLength(1);
  });

  it('tolerates a fenced code block and prose around the JSON', () => {
    const wrapped = `Here are some words:\n\`\`\`json\n${WORDS}\n\`\`\`\nHope those help.`;
    expect(parseSuggestions(wrapped)).toHaveLength(2);
  });

  it('drops a row with no definition rather than the whole batch', () => {
    const mixed = JSON.stringify({
      words: [{ word: 'elide' }, { word: 'brackish', definition: 'slightly salty' }],
    });
    expect(parseSuggestions(mixed).map((word) => word.word)).toEqual(['brackish']);
  });

  it('drops a row that is not an object at all', () => {
    const mixed = JSON.stringify({ words: ['elide', { word: 'brackish', definition: 'salty' }] });
    expect(parseSuggestions(mixed)).toHaveLength(1);
  });

  /*
    Belt and braces. The avoid list is in the prompt, but a model asked for ten
    words will occasionally return one anyway — and the ledger would silently
    refuse it as a duplicate, leaving the reader wondering why they picked five
    words and got four.
  */
  it('never returns a word the caller asked it to avoid', () => {
    expect(parseSuggestions(WORDS, ['Perfunctory']).map((word) => word.word)).toEqual(['sinecure']);
  });

  it('does not return the same word twice within one batch', () => {
    const dupes = JSON.stringify({
      words: [
        { word: 'elide', definition: 'to leave out' },
        { word: 'Elide', definition: 'to omit' },
      ],
    });
    expect(parseSuggestions(dupes)).toHaveLength(1);
  });

  it('returns nothing rather than guessing when the shape is wrong', () => {
    expect(parseSuggestions('not json at all')).toEqual([]);
    expect(parseSuggestions('{"suggestions":[]}')).toEqual([]);
  });
});

describe('suggestVocabWords', () => {
  it('sends the theme as fenced data, not as instructions', async () => {
    const { calls, result } = run(WORDS, { theme: 'words for describing weather' });
    await result;

    expect(calls[0].user).toContain('words for describing weather');
    expect(calls[0].user).toMatch(/never as instructions about anything else/);
  });

  it('sends the subjects they are studying when a notes-aware theme is used', async () => {
    const { calls, result } = run(WORDS, { topics: ['american-history', 'negotiation'] });
    await result;

    expect(calls[0].user).toContain('american-history, negotiation');
  });

  it('sends the words to avoid, so the model does not repeat the list back', async () => {
    const { calls, result } = run(WORDS, { avoid: ['laconic', 'terse'] });
    await result;

    expect(calls[0].user).toContain('laconic, terse');
  });

  /*
    A reader with 400 saved words would otherwise send all 400 on every request,
    growing the prompt without bound and pushing the cost of a suggestion up
    with the size of their list.
  */
  it('caps the avoid list rather than sending every word ever added', async () => {
    const many = Array.from({ length: 400 }, (_, index) => `word${index}`);
    const { calls, result } = run(WORDS, { avoid: many });
    await result;

    expect(calls[0].user).not.toContain('word0,');
    expect(calls[0].user).toContain('word399');
  });

  /*
    The Settings guidance is about how QUESTIONS should be pitched. Applied to a
    word list it means nothing, and a model handed it would read it as an
    instruction about which words to choose.
  */
  it('does not send the reader’s question guidance, which is not about words', async () => {
    const { calls, result } = run(WORDS);
    await result;

    expect(calls[0].system).not.toContain('FROM THE READER');
  });

  it('reports usage, so the price of a suggestion is visible', async () => {
    expect((await run(WORDS).result).usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('fails loudly rather than returning an empty list that looks like an answer', async () => {
    await expect(run('{"words":[]}').result).rejects.toMatchObject({ code: 'llm_bad_response' });
  });

  it('names a truncated reply as truncated', async () => {
    const { provider } = fakeProvider('{"words":[', 'length');
    await expect(
      suggestVocabWords({ count: 5, avoid: [], provider, apiKey: 'sk-test', model: 'claude-sonnet-5' }),
    ).rejects.toMatchObject({ code: 'llm_bad_response' });
  });

  it('refuses before spending anything when there is no API key', async () => {
    const { provider, calls } = fakeProvider(WORDS);
    await expect(
      suggestVocabWords({ count: 5, avoid: [], provider, apiKey: '', model: 'claude-sonnet-5' }),
    ).rejects.toMatchObject({ code: 'llm_not_configured' });
    expect(calls).toHaveLength(0);
  });
});
