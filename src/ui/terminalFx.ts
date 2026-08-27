import { createStore } from '../lib/createStore';
import { themeStore } from './theme';

/**
 * The Terminal theme's screen effects — the part of the CRT look that is
 * behaviour rather than palette, so the part a reader may want off while
 * keeping the green: a scanline overlay on every screen, and question prompts
 * that type themselves out under a block cursor.
 *
 * Both default ON. The theme is the drama; picking it is the opt-in, and the
 * switches here (on the Appearance screen) are the opt-out.
 *
 * Same shape as the theme store, for the same reason: this module is imported
 * by components and so must stay importable under jest — kv-free. Persistence
 * lives in `themePersistence.ts`, pulled in only by the root layout.
 */
export type TerminalFx = {
  /** Scanlines and shaded tube corners drawn over every screen. */
  crtScreen: boolean;
  /** Question prompts type themselves out under a blinking block cursor. */
  typewriter: boolean;
};

export const DEFAULT_TERMINAL_FX: TerminalFx = { crtScreen: true, typewriter: true };

export const terminalFxStore = createStore<TerminalFx>(DEFAULT_TERMINAL_FX);

export function setTerminalFx(patch: Partial<TerminalFx>): void {
  terminalFxStore.set((previous) => ({ ...previous, ...patch }));
}

/**
 * Whether to draw the CRT overlay RIGHT NOW — the preference AND the theme.
 * The gate lives here rather than in callers so no other theme can ever grow
 * scanlines by accident: outside Terminal these hooks are constant `false`.
 */
export function useCrtScreen(): boolean {
  const active = themeStore.use() === 'terminal';
  const wanted = terminalFxStore.useSelector((fx) => fx.crtScreen);
  return active && wanted;
}

/** Whether prompts should type themselves out right now. Same gate. */
export function useTypewriter(): boolean {
  const active = themeStore.use() === 'terminal';
  const wanted = terminalFxStore.useSelector((fx) => fx.typewriter);
  return active && wanted;
}
