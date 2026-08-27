const mockKv: { store: Map<string, string> } = { store: new Map() };

jest.mock('../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: (key: string) => {
    const raw = mockKv.store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  },
  writeJson: async (key: string, value: unknown) => {
    mockKv.store.set(key, JSON.stringify(value));
  },
}));

import { DEFAULT_TERMINAL_FX, setTerminalFx, terminalFxStore } from './terminalFx';
import { DEFAULT_THEME, setTheme, themeStore } from './theme';
import { initThemePersistence } from './themePersistence';

const THEME_KEY = 'quizbot.theme.v1';
const TERMINAL_FX_KEY = 'quizbot.terminalfx.v1';

afterEach(() => {
  setTheme(DEFAULT_THEME);
  terminalFxStore.set(DEFAULT_TERMINAL_FX);
  mockKv.store.clear();
});

describe('theme persistence', () => {
  it('applies a stored theme on init', () => {
    mockKv.store.set(THEME_KEY, JSON.stringify('terminal'));
    initThemePersistence();
    expect(themeStore.get()).toBe('terminal');
  });

  // 'hotdog-stand' held this job until it became a real theme.
  it('ignores an unknown stored value rather than crashing into it', () => {
    mockKv.store.set(THEME_KEY, JSON.stringify('aero-glass'));
    initThemePersistence();
    expect(themeStore.get()).toBe(DEFAULT_THEME);
  });

  it('saves every change made after init', async () => {
    initThemePersistence();
    setTheme('paper');
    // The write is fire-and-forget; give the microtask queue a turn.
    await Promise.resolve();
    expect(mockKv.store.get(THEME_KEY)).toBe(JSON.stringify('paper'));
  });
});

describe('terminal fx persistence', () => {
  it('applies stored switches on init', () => {
    mockKv.store.set(TERMINAL_FX_KEY, JSON.stringify({ crtScreen: false, typewriter: true }));
    initThemePersistence();
    expect(terminalFxStore.get()).toEqual({ crtScreen: false, typewriter: true });
  });

  it('reads a record from before a switch existed as that switch at its default', () => {
    mockKv.store.set(TERMINAL_FX_KEY, JSON.stringify({ crtScreen: false }));
    initThemePersistence();
    expect(terminalFxStore.get()).toEqual({ crtScreen: false, typewriter: DEFAULT_TERMINAL_FX.typewriter });
  });

  it('saves switch changes made after init', async () => {
    initThemePersistence();
    setTerminalFx({ typewriter: false });
    await Promise.resolve();
    expect(mockKv.store.get(TERMINAL_FX_KEY)).toBe(JSON.stringify({ crtScreen: true, typewriter: false }));
  });
});
