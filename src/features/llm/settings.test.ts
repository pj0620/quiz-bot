jest.mock('../../lib/kv', () => ({
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
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
  getLlmSettings,
  getModelFor,
  hydrateKeyStatus,
  llmStore,
  removeApiKey,
  saveApiKey,
  setGeneratorId,
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
  jest.clearAllMocks();
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
});
