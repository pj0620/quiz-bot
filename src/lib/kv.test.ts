const mockStore = new Map<string, string>();
let mockThrowOnRead = false;

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => {
      if (mockThrowOnRead) throw new Error('database is locked');
      return mockStore.get(key) ?? null;
    },
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStore.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStore.delete(key);
    },
  },
}));

import { getItemSync, isStorageDegraded, readJsonSync, setItem, writeJson } from './kv';

beforeEach(() => {
  mockStore.clear();
  mockThrowOnRead = false;
  // A clean successful read clears any degraded flag left by a previous test.
  getItemSync('warmup');
});

describe('degraded storage', () => {
  it('treats a missing key as empty, not as a failure', () => {
    expect(getItemSync('absent')).toBeNull();
    expect(isStorageDegraded()).toBe(false);
  });

  it('marks storage degraded when a read throws', () => {
    mockThrowOnRead = true;
    expect(getItemSync('anything')).toBeNull();
    expect(isStorageDegraded()).toBe(true);
  });

  /*
    The bug this exists for. A store hydrates empty because the read failed,
    then its first mutation persists that empty state over real data — silently,
    and with no way back.
  */
  it('refuses to write after a failed read, rather than overwriting real data', async () => {
    mockStore.set('quizbot.questions.v2', '{"version":1,"items":[1,2,3]}');

    mockThrowOnRead = true;
    readJsonSync('quizbot.questions.v2'); // hydration "succeeds" with null

    await expect(writeJson('quizbot.questions.v2', { version: 1, items: [] })).rejects.toThrow();
    // The real data is still there.
    expect(mockStore.get('quizbot.questions.v2')).toBe('{"version":1,"items":[1,2,3]}');
  });

  it('allows writes again once a read succeeds', async () => {
    mockThrowOnRead = true;
    getItemSync('x');
    expect(isStorageDegraded()).toBe(true);

    mockThrowOnRead = false;
    getItemSync('x');
    expect(isStorageDegraded()).toBe(false);

    await setItem('x', 'value');
    expect(mockStore.get('x')).toBe('value');
  });

  it('lets a genuinely fresh install write normally', async () => {
    // No stored value and no throw — the flag must stay clear, or a first run
    // could never save anything.
    expect(readJsonSync('quizbot.sources.v1')).toBeNull();
    expect(isStorageDegraded()).toBe(false);

    await writeJson('quizbot.sources.v1', { version: 1, sources: [] });
    expect(mockStore.get('quizbot.sources.v1')).toContain('"version":1');
  });
});
