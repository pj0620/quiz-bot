/**
 * The "my generation notes vanished after an app update" bug, as tests.
 *
 * The mechanism: an update forces a cold launch; the first synchronous read
 * can fail transiently right then; settings hydrate as defaults with an empty
 * guidance string; and the next unrelated settings write persists that empty
 * string over the real note. The fixes under test: guidance has its own key
 * that only `setGuidance` writes, and a degraded hydration schedules an async
 * recovery read.
 */

const mockKv = {
  store: new Map<string, string>(),
  /** Keys whose reads fail — the transient cold-launch failure, simulated. */
  broken: new Set<string>(),
  degraded: false,
};

jest.mock('../../lib/kv', () => ({
  readJsonSync: (key: string) => {
    // Mirrors the real kv: the degraded flag reflects the most recent sync read.
    if (mockKv.broken.has(key)) {
      mockKv.degraded = true;
      return null;
    }
    mockKv.degraded = false;
    const raw = mockKv.store.get(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  isStorageDegraded: () => mockKv.degraded,
  getItemSync: (key: string) => mockKv.store.get(key) ?? null,
  // The real getItem swallows errors into null, and never touches the flag.
  getItem: async (key: string) => (mockKv.broken.has(key) ? null : (mockKv.store.get(key) ?? null)),
  setItem: async (key: string, value: string) => {
    mockKv.store.set(key, value);
  },
  writeJson: async (key: string, value: unknown) => {
    mockKv.store.set(key, JSON.stringify(value));
  },
  removeItem: async (key: string) => {
    mockKv.store.delete(key);
  },
}));

jest.mock('./auth/secureKeyStore', () => ({
  readApiKey: jest.fn(async () => null),
  writeApiKey: jest.fn(async () => undefined),
  deleteApiKey: jest.fn(async () => undefined),
}));

const SETTINGS_KEY = 'quizbot.llm.settings.v1';
const GUIDANCE_KEY = 'quizbot.llm.guidance.v1';

type SettingsModule = typeof import('./settings');

/** A fresh module instance against the mock's current state — a "launch". */
function launch(): SettingsModule {
  let loadedModule: SettingsModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadedModule = require('./settings') as SettingsModule;
  });
  return loadedModule!;
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockKv.store.clear();
  mockKv.broken.clear();
  mockKv.degraded = false;
});

describe('guidance persistence', () => {
  it('writes the note to its own key as well as the settings blob', async () => {
    const settings = launch();
    settings.setGuidance('Ask why, not when.');
    await flushMicrotasks();

    expect(mockKv.store.get(GUIDANCE_KEY)).toBe(JSON.stringify('Ask why, not when.'));
    expect(JSON.parse(mockKv.store.get(SETTINGS_KEY)!)).toMatchObject({
      guidance: 'Ask why, not when.',
    });
  });

  it('prefers the dedicated key over the blob copy on load', () => {
    mockKv.store.set(SETTINGS_KEY, JSON.stringify({ guidance: 'stale blob copy' }));
    mockKv.store.set(GUIDANCE_KEY, JSON.stringify('the real note'));

    expect(launch().getGuidance()).toBe('the real note');
  });

  it('reads an old install’s note out of the blob, and migrates it', async () => {
    mockKv.store.set(
      SETTINGS_KEY,
      JSON.stringify({ generatorId: 'anthropic', guidance: 'from before the split' }),
    );

    const settings = launch();
    expect(settings.getGuidance()).toBe('from before the split');

    await flushMicrotasks();
    expect(mockKv.store.get(GUIDANCE_KEY)).toBe(JSON.stringify('from before the split'));
  });

  /*
    THE reported bug, end to end. The blob gets clobbered while its read is
    broken — and the note still comes back, because the dedicated key was
    never part of that write.
  */
  it('survives the blob being overwritten with defaults during an outage', async () => {
    mockKv.store.set(
      SETTINGS_KEY,
      JSON.stringify({ generatorId: 'anthropic', guidance: 'my precious note' }),
    );
    mockKv.store.set(GUIDANCE_KEY, JSON.stringify('my precious note'));

    // Cold launch after an update: every read of every key fails.
    mockKv.broken.add(SETTINGS_KEY).add(GUIDANCE_KEY);
    const degradedLaunch = launch();
    expect(degradedLaunch.getGuidance()).toBe(''); // hydrated as fallback

    // The user changes some unrelated setting, which persists the whole
    // defaulted blob — the write that used to destroy the note.
    degradedLaunch.setGeneratorId('openai');
    await flushMicrotasks();
    expect(JSON.parse(mockKv.store.get(SETTINGS_KEY)!).guidance).toBe('');

    // Storage heals; the next launch still has the note.
    mockKv.broken.clear();
    expect(launch().getGuidance()).toBe('my precious note');
  });

  it('recovers a degraded hydration as soon as storage answers again', async () => {
    mockKv.store.set(
      SETTINGS_KEY,
      JSON.stringify({ generatorId: 'anthropic', guidance: 'kept note' }),
    );
    mockKv.store.set(GUIDANCE_KEY, JSON.stringify('kept note'));

    // Sync reads fail at launch; async reads work — the transient case.
    mockKv.broken.add(SETTINGS_KEY).add(GUIDANCE_KEY);
    const settings = launch();
    expect(settings.getGuidance()).toBe('');
    mockKv.broken.clear();

    expect(await settings.recoverSettingsFromStorage([])).toBe(true);
    expect(settings.getGuidance()).toBe('kept note');
    expect(settings.getLlmSettings().generatorId).toBe('anthropic');
  });

  it('never lets recovery overwrite what the user typed in the meantime', async () => {
    mockKv.store.set(GUIDANCE_KEY, JSON.stringify('old note'));
    mockKv.broken.add(GUIDANCE_KEY).add(SETTINGS_KEY);

    const settings = launch();
    // The user gets there first — their words are newer than anything stored.
    settings.setGuidance('what I just typed');
    mockKv.broken.clear();

    await settings.recoverSettingsFromStorage([]);
    expect(settings.getGuidance()).toBe('what I just typed');
  });

  it('reports failure when storage stays broken, rather than pretending', async () => {
    mockKv.store.set(GUIDANCE_KEY, JSON.stringify('unreachable'));
    mockKv.broken.add(GUIDANCE_KEY).add(SETTINGS_KEY);

    const settings = launch();
    expect(await settings.recoverSettingsFromStorage([])).toBe(false);
    expect(settings.getGuidance()).toBe('');
  });

  it('changing any other setting leaves the dedicated key untouched', async () => {
    mockKv.store.set(GUIDANCE_KEY, JSON.stringify('the note'));

    const settings = launch();
    settings.setGeneratorId('anthropic');
    settings.setConcurrency(3);
    await flushMicrotasks();

    expect(mockKv.store.get(GUIDANCE_KEY)).toBe(JSON.stringify('the note'));
  });
});
