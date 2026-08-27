import { readJsonSync, writeJson } from '../lib/kv';
import { DEFAULT_TERMINAL_FX, terminalFxStore, type TerminalFx } from './terminalFx';
import { isThemeName, setTheme, themeStore } from './theme';

/**
 * Theme persistence, split out of `theme.ts` on purpose.
 *
 * `theme.ts` is imported by every component in the app, including under jest —
 * where `expo-sqlite/kv-store` cannot even be REQUIRED (its first line reaches
 * for a native binding). Keeping the kv import here means only the app's root
 * layout, which never runs under jest, ever touches storage; component tests
 * get the in-memory default and no mocking burden.
 */

const THEME_KEY = 'quizbot.theme.v1';
const TERMINAL_FX_KEY = 'quizbot.terminalfx.v1';

let persisting = false;

/**
 * Reads the saved theme and starts saving future changes. Idempotent.
 *
 * Called from the root layout at MODULE scope, which is what makes the switch
 * flicker-free on launch: it runs before the first render, so the very first
 * frame is already in the reader's theme rather than repainting a beat later.
 */
export function initThemePersistence(): void {
  const stored = readJsonSync<string>(THEME_KEY);
  if (isThemeName(stored)) setTheme(stored);

  // Merged over the defaults, so a settings shape that grows a field later
  // reads an old record as "that field at its default" rather than as junk.
  const storedFx = readJsonSync<Partial<TerminalFx>>(TERMINAL_FX_KEY);
  if (storedFx && typeof storedFx === 'object') {
    terminalFxStore.set({
      crtScreen: typeof storedFx.crtScreen === 'boolean' ? storedFx.crtScreen : DEFAULT_TERMINAL_FX.crtScreen,
      typewriter: typeof storedFx.typewriter === 'boolean' ? storedFx.typewriter : DEFAULT_TERMINAL_FX.typewriter,
    });
  }

  if (persisting) return;
  persisting = true;
  themeStore.subscribe(() => {
    // Fire-and-forget: a failed preference write must not break the switch.
    void writeJson(THEME_KEY, themeStore.get()).catch(() => undefined);
  });
  terminalFxStore.subscribe(() => {
    void writeJson(TERMINAL_FX_KEY, terminalFxStore.get()).catch(() => undefined);
  });
}
