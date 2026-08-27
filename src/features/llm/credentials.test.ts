jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('./auth/secureKeyStore', () => ({
  readApiKey: jest.fn(async () => null),
  writeApiKey: jest.fn(async () => undefined),
  deleteApiKey: jest.fn(async () => undefined),
}));

import { readApiKey } from './auth/secureKeyStore';
import { resolveCredentials, resolveCredentialsOrNull, resolveTarget } from './credentials';
import {
  setGeneratorId,
  setGuidance,
  setJudgeId,
  setJudgeModel,
  setModel,
} from './settings';
import type { LlmProviderId } from './types';

const mockedReadApiKey = readApiKey as jest.MockedFunction<typeof readApiKey>;

/** Every provider has a key unless a test says otherwise. */
function keysFor(...providers: LlmProviderId[]): void {
  mockedReadApiKey.mockImplementation(async (id) =>
    providers.includes(id) ? `key-for-${id}` : null,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setGeneratorId('openai');
  setJudgeId('match');
  setModel('openai', 'gpt-5.6-terra');
  setModel('anthropic', 'claude-sonnet-5');
  setJudgeModel('openai', 'gpt-5.6-luna');
  setJudgeModel('anthropic', 'claude-haiku-4-5-20251001');
  setGuidance('');
  keysFor('openai', 'anthropic');
});

describe('which model does which job', () => {
  it('marks with the generator when marking is left on "same"', async () => {
    /*
      The default, and the behaviour the app had before the two could differ.
      Marking with a DIFFERENT model than the one chosen, without being asked
      to, is the failure this pins down.
    */
    expect(resolveTarget('judge')).toEqual({ providerId: 'openai', model: 'gpt-5.6-terra' });

    const judge = await resolveCredentialsOrNull('judge');
    const writer = await resolveCredentialsOrNull('generate');
    expect(judge?.model).toBe(writer?.model);
    expect(judge?.provider.id).toBe(writer?.provider.id);
  });

  it('marks with its own provider and model once one is chosen', async () => {
    setJudgeId('anthropic');

    const judge = await resolveCredentialsOrNull('judge');
    expect(judge?.provider.id).toBe('anthropic');
    expect(judge?.model).toBe('claude-haiku-4-5-20251001');
    expect(judge?.apiKey).toBe('key-for-anthropic');

    // Writing is untouched by the choice — the whole point of separating them.
    const writer = await resolveCredentialsOrNull('generate');
    expect(writer?.provider.id).toBe('openai');
    expect(writer?.model).toBe('gpt-5.6-terra');
  });

  it('keeps a cheap judge model apart from the same provider’s writing model', async () => {
    // Same provider for both jobs, different models: the case a single stored
    // model per provider could not express at all.
    setJudgeId('openai');

    expect((await resolveCredentialsOrNull('generate'))?.model).toBe('gpt-5.6-terra');
    expect((await resolveCredentialsOrNull('judge'))?.model).toBe('gpt-5.6-luna');
  });

  it('marks with a real model even when questions are generated offline', async () => {
    /*
      Mock generation plus a real judge is a legitimate combination — free
      questions, marked properly — and it is only reachable because judging
      resolves independently rather than falling back to the generator first.
    */
    setGeneratorId('mock');
    setJudgeId('anthropic');

    expect(await resolveCredentialsOrNull('generate')).toBeNull();
    expect((await resolveCredentialsOrNull('judge'))?.provider.id).toBe('anthropic');
  });

  it('has nothing to mark with when mock generates and marking follows it', async () => {
    setGeneratorId('mock');
    expect(resolveTarget('judge')).toBeNull();
    expect(await resolveCredentialsOrNull('judge')).toBeNull();
  });
});

describe('a missing key', () => {
  it('returns null for marking rather than throwing mid-quiz', async () => {
    // Never an exception on this path: the screen falls back to the self-grade
    // buttons, and losing someone's place in a quiz over a missing key would be
    // a far worse answer than asking them to mark one sentence.
    setJudgeId('anthropic');
    keysFor('openai');

    expect(resolveTarget('judge')).not.toBeNull();
    expect(await resolveCredentialsOrNull('judge')).toBeNull();
  });

  it('throws for a run, which must not start half-configured', async () => {
    keysFor();
    await expect(resolveCredentials('openai')).rejects.toMatchObject({
      code: 'llm_not_configured',
    });
  });
});
