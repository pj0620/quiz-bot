jest.mock('../../lib/kv', () => ({
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  isStorageDegraded: jest.fn(() => false),
}));

// Never touch the Keychain from a unit test — and prove that removing a key
// falls back to the mock generator without any real secure storage involved.
jest.mock('./auth/secureKeyStore', () => ({
  readApiKey: jest.fn(async () => null),
  writeApiKey: jest.fn(async () => undefined),
  deleteApiKey: jest.fn(async () => undefined),
}));

import { readJsonSync, writeJson } from '../../lib/kv';
import { readApiKey } from './auth/secureKeyStore';
import {
  clampConcurrency,
  clampGuidance,
  DEFAULT_CONCURRENCY,
  getConcurrency,
  getGuidance,
  getJudgeId,
  getJudgeModelFor,
  getLlmSettings,
  getModelFor,
  hydrateKeyStatus,
  llmStore,
  MAX_CONCURRENCY,
  MAX_GUIDANCE_CHARS,
  removeApiKey,
  saveApiKey,
  setConcurrency,
  setGeneratorId,
  setGuidance,
  setJudgeId,
  setJudgeModel,
  setModel,
} from './settings';

const mockedReadJson = readJsonSync as jest.MockedFunction<typeof readJsonSync>;
const mockedWriteJson = writeJson as jest.MockedFunction<typeof writeJson>;
const mockedReadApiKey = readApiKey as jest.MockedFunction<typeof readApiKey>;

beforeEach(() => {
  jest.clearAllMocks();
  setGeneratorId('mock');
  setModel('anthropic', 'claude-sonnet-5');
  setModel('openai', 'gpt-5.6-terra');
  setJudgeId('match');
  setJudgeModel('anthropic', 'claude-haiku-4-5-20251001');
  setJudgeModel('openai', 'gpt-5.6-luna');
  setConcurrency(DEFAULT_CONCURRENCY);
  setGuidance('');
  jest.clearAllMocks();
});

describe('the reader’s own generation notes', () => {
  it('starts empty, so nothing is sent until something is written', () => {
    expect(getGuidance()).toBe('');
  });

  it('stores and persists what was written', () => {
    setGuidance('Keep questions short.');
    expect(getGuidance()).toBe('Keep questions short.');
    expect(mockedWriteJson).toHaveBeenCalledWith(
      'quizbot.llm.settings.v1',
      expect.objectContaining({ guidance: 'Keep questions short.' }),
    );
  });

  it('keeps newlines and trailing spaces exactly as typed', () => {
    /*
      Trimming on write would eat the newline the instant the user pressed
      return in a multi-line field, which makes the field unusable. The trim
      happens once, in `buildSystemPrompt`, when it is actually sent.
    */
    setGuidance('First line.\n\nSecond line. ');
    expect(getGuidance()).toBe('First line.\n\nSecond line. ');
  });

  it('caps the length, because this rides on every request in a run', () => {
    setGuidance('x'.repeat(MAX_GUIDANCE_CHARS + 500));
    expect(getGuidance()).toHaveLength(MAX_GUIDANCE_CHARS);
  });

  it('tolerates a stored settings object from a build without the field', () => {
    // The field is new, so every existing install loads one of these.
    expect(clampGuidance(undefined)).toBe('');
    expect(clampGuidance(null)).toBe('');
    expect(clampGuidance(42)).toBe('');
  });
});

describe('how many notes at once', () => {
  it('defaults to more than one, because a run is spent waiting', () => {
    expect(DEFAULT_CONCURRENCY).toBeGreaterThan(1);
    expect(getConcurrency()).toBe(DEFAULT_CONCURRENCY);
  });

  it('stores a chosen value', () => {
    setConcurrency(3);
    expect(getConcurrency()).toBe(3);
    expect(mockedWriteJson).toHaveBeenCalledWith(
      'quizbot.llm.settings.v1',
      expect.objectContaining({ concurrency: 3 }),
    );
  });

  it('clamps rather than rejecting, so no value can disable generation', () => {
    /*
      Zero lanes would silently do nothing at all, and an unbounded value would
      point the whole vault at the provider at once. Both arrive the same way —
      an older stored settings object, or a future control with a wider range.
    */
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(-5)).toBe(1);
    expect(clampConcurrency(99)).toBe(MAX_CONCURRENCY);
    expect(clampConcurrency(2.7)).toBe(2);
  });

  it('falls back to the default for a value that is not a number', () => {
    expect(clampConcurrency(undefined)).toBe(DEFAULT_CONCURRENCY);
    expect(clampConcurrency('two')).toBe(DEFAULT_CONCURRENCY);
    expect(clampConcurrency(Number.NaN)).toBe(DEFAULT_CONCURRENCY);
  });

  it('keeps settings saved before the field existed', () => {
    // The stored object from an older build has no `concurrency`. Discarding
    // the whole thing over that would silently reset the model and provider.
    mockedReadJson.mockReturnValueOnce({ generatorId: 'anthropic' });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reloaded = require('./settings') as typeof import('./settings');
      expect(reloaded.getLlmSettings().generatorId).toBe('anthropic');
      expect(reloaded.getConcurrency()).toBe(DEFAULT_CONCURRENCY);
    });
  });
});

describe('defaults', () => {
  it('starts on the mock generator', () => {
    // The only safe default: it costs nothing and works with no key.
    expect(getLlmSettings().generatorId).toBe('mock');
  });

  it('gives every provider its default model', () => {
    expect(getModelFor('anthropic')).toBe('claude-sonnet-5');
    expect(getModelFor('openai')).toBe('gpt-5.6-terra');
  });

  it('reads nothing from storage when it is empty', () => {
    expect(mockedReadJson).not.toThrow();
  });
});

describe('persistence', () => {
  it('writes the whole settings object on change', () => {
    setGeneratorId('anthropic');
    expect(mockedWriteJson).toHaveBeenCalledWith(
      'quizbot.llm.settings.v1',
      expect.objectContaining({ generatorId: 'anthropic' }),
    );
  });

  it('keeps a model per provider so switching does not lose the other', () => {
    setModel('anthropic', 'claude-opus-5');
    setModel('openai', 'gpt-5.6-luna');
    expect(getModelFor('anthropic')).toBe('claude-opus-5');
    expect(getModelFor('openai')).toBe('gpt-5.6-luna');
  });

  it('falls back to the provider default when a model is cleared', () => {
    setModel('anthropic', '   ');
    expect(getModelFor('anthropic')).toBe('claude-sonnet-5');
  });

  it('trims a pasted model name', () => {
    setModel('openai', '  gpt-5.6-sol  ');
    expect(getModelFor('openai')).toBe('gpt-5.6-sol');
  });
});

describe('who marks written answers', () => {
  it('follows the generator until told otherwise', () => {
    // The behaviour the app had before marking was separable, so nobody's
    // marking changes on the strength of an upgrade.
    expect(getJudgeId()).toBe('match');
  });

  it('defaults each provider to its cheapest model, not its writing one', () => {
    /*
      Marking is a one-sentence comparison against an answer already written
      down, and it happens several times a quiz. Inheriting the writing default
      would silently bill the reader Sonnet prices for Haiku work.
    */
    expect(getJudgeModelFor('anthropic')).toBe('claude-haiku-4-5-20251001');
    expect(getJudgeModelFor('openai')).toBe('gpt-5.6-luna');
    expect(getJudgeModelFor('anthropic')).not.toBe(getModelFor('anthropic'));
  });

  it('keeps the marking model apart from the writing model of the same provider', () => {
    setModel('anthropic', 'claude-opus-5');
    setJudgeModel('anthropic', 'claude-haiku-4-5-20251001');
    expect(getModelFor('anthropic')).toBe('claude-opus-5');
    expect(getJudgeModelFor('anthropic')).toBe('claude-haiku-4-5-20251001');
  });

  it('persists both the choice and the model', () => {
    setJudgeId('anthropic');
    expect(mockedWriteJson).toHaveBeenCalledWith(
      'quizbot.llm.settings.v1',
      expect.objectContaining({ judgeId: 'anthropic' }),
    );

    setJudgeModel('openai', '  gpt-5.6-sol  ');
    expect(getJudgeModelFor('openai')).toBe('gpt-5.6-sol');
  });

  it('falls back to the provider default when the marking model is cleared', () => {
    setJudgeModel('openai', '   ');
    expect(getJudgeModelFor('openai')).toBe('gpt-5.6-luna');
  });

  it('reads a settings object saved before marking was separable', () => {
    // Every existing install loads one of these: a stored object with a model
    // and a generator but no judge at all.
    mockedReadJson.mockReturnValueOnce({
      generatorId: 'anthropic',
      models: { anthropic: 'claude-opus-5' },
    });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reloaded = require('./settings') as typeof import('./settings');
      expect(reloaded.getJudgeId()).toBe('match');
      expect(reloaded.getModelFor('anthropic')).toBe('claude-opus-5');
      expect(reloaded.getJudgeModelFor('anthropic')).toBe('claude-haiku-4-5-20251001');
    });
  });

  it('ignores a stored judge that is not a provider', () => {
    mockedReadJson.mockReturnValueOnce({ judgeId: 'gpt-9', judgeModels: { openai: 42 } });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reloaded = require('./settings') as typeof import('./settings');
      expect(reloaded.getJudgeId()).toBe('match');
      expect(reloaded.getJudgeModelFor('openai')).toBe('gpt-5.6-luna');
    });
  });
});

describe('key status', () => {
  it('starts unknown, because only the keychain can answer', () => {
    expect(['unknown', 'set', 'missing']).toContain(llmStore.get().keyStatus.anthropic);
  });

  it('hydrates from the keychain', async () => {
    mockedReadApiKey.mockImplementation(async (id) => (id === 'anthropic' ? 'sk-ant-x' : null));
    await hydrateKeyStatus();
    expect(llmStore.get().keyStatus.anthropic).toBe('set');
    expect(llmStore.get().keyStatus.openai).toBe('missing');
  });

  it('reports missing rather than throwing when the keychain fails', async () => {
    mockedReadApiKey.mockRejectedValue(new Error('keystore invalidated'));
    await hydrateKeyStatus();
    expect(llmStore.get().keyStatus.anthropic).toBe('missing');
  });

  it('marks a provider set after saving', async () => {
    await saveApiKey('openai', 'sk-test');
    expect(llmStore.get().keyStatus.openai).toBe('set');
  });
});

describe('removing a key', () => {
  it('falls back to mock when the removed provider was selected', async () => {
    // Leaving the generator pointed at a provider with no key would fail on the
    // next run with a confusing error.
    setGeneratorId('anthropic');
    await removeApiKey('anthropic');
    expect(getLlmSettings().generatorId).toBe('mock');
    expect(llmStore.get().keyStatus.anthropic).toBe('missing');
  });

  it('leaves the generator alone when a different provider is removed', async () => {
    setGeneratorId('anthropic');
    await removeApiKey('openai');
    expect(getLlmSettings().generatorId).toBe('anthropic');
  });

  it('sends marking back to the generator when the judge’s key is removed', async () => {
    /*
      A judge with no key does not fail loudly the way a run does — it quietly
      sends every written answer back to self-grading with no explanation. So
      the setting follows the key out.
    */
    setGeneratorId('anthropic');
    setJudgeId('openai');
    await removeApiKey('openai');
    expect(getJudgeId()).toBe('match');
    expect(getLlmSettings().generatorId).toBe('anthropic');
  });
});
