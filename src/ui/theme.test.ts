import {
  accents,
  colors,
  DEFAULT_THEME,
  isThemeName,
  listThemes,
  radius,
  setTheme,
  themedSheet,
  themedTokens,
  themes,
  themeStore,
  type,
} from './theme';

afterEach(() => {
  // Tokens are module state mutated in place — leave them as found.
  setTheme(DEFAULT_THEME);
});

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('themes', () => {
  it('knows its own names', () => {
    expect(isThemeName('terminal')).toBe(true);
    expect(isThemeName('solarized')).toBe(false);
    expect(isThemeName(undefined)).toBe(false);
    expect(listThemes().map((theme) => theme.name)).toEqual(['midnight', 'terminal', 'ink', 'paper', 'xp']);
  });

  /*
    The guard that makes a palette a contract rather than a mood board: body
    text must clear WCAG AA on the surfaces it actually sits on, in every
    theme, and button text must clear it on the button fill. A theme that
    fails this is a screen someone cannot read, however good it looks.
  */
  it.each(listThemes().map((theme) => [theme.name, theme.palette] as const))(
    '%s keeps text readable',
    (_name, palette) => {
      expect(contrast(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.primaryText, palette.primary)).toBeGreaterThanOrEqual(4.5);
      // Secondary text: readable, if not AA-body-text strong.
      expect(contrast(palette.textMuted, palette.background)).toBeGreaterThanOrEqual(3.5);
      expect(contrast(palette.codeText, palette.code)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('mutates the shared token objects in place, so render-time reads follow', () => {
    const before = colors.background;
    setTheme('terminal');

    expect(themeStore.get()).toBe('terminal');
    expect(colors.background).toBe(themes.terminal.palette.background);
    expect(colors.background).not.toBe(before);
    // Accents are derived from the palette and must follow it.
    expect(accents.primary.fg).toBe(themes.terminal.palette.primary);
  });

  it('sets the whole type scale in monospace for Terminal, and only for it', () => {
    setTheme('terminal');
    expect(type.body.fontFamily).toBeDefined();
    expect(type.display.fontFamily).toBe(type.mono.fontFamily);

    setTheme('paper');
    expect(type.body.fontFamily).toBeUndefined();
    // The code token is monospace in every theme — that's its job.
    expect(type.mono.fontFamily).toBeDefined();
  });

  it('gives Terminal glowing glyphs and square corners, and only Terminal', () => {
    setTheme('terminal');
    expect(type.body.textShadowColor).toBe(themes.terminal.glow);
    expect(type.display.textShadowRadius).toBeGreaterThan(0);
    expect(radius.lg).toBe(0);
    expect(radius.pill).toBe(0);

    setTheme('midnight');
    expect(type.body.textShadowColor).toBeUndefined();
    expect(radius.lg).toBeGreaterThan(0);
    expect(radius.pill).toBeGreaterThan(0);
  });

  it('gives XP its Luna face — the themed family and the tight corners — and takes both back', () => {
    setTheme('xp');
    // The whole UI scale moves to the theme's family; code stays mono.
    expect(type.body.fontFamily).toBe(themes.xp.fontFamily);
    expect(type.display.fontFamily).toBe(themes.xp.fontFamily);
    expect(type.mono.fontFamily).not.toBe(themes.xp.fontFamily);
    // XP's own corner scale, not the modern default and not CRT-square.
    expect(radius.md).toBe(themes.xp.radii?.md);
    expect(radius.pill).toBe(themes.xp.radii?.pill);

    setTheme('midnight');
    expect(type.body.fontFamily).toBeUndefined();
    expect(radius.pill).toBe(999);
  });

  it('keeps the dramatics out of the other themes entirely', () => {
    for (const theme of listThemes()) {
      if (theme.name === 'terminal') continue;
      expect(theme.crt).toBe(false);
      expect(theme.glow).toBeUndefined();
      expect(theme.monospaced).toBe(false);
    }
  });

  it('serves each theme its own sheet through one stable object', () => {
    const styles = themedSheet(() => ({ page: { backgroundColor: colors.background } }));

    const midnightPage = styles.page;
    expect(midnightPage.backgroundColor).toBe(themes.midnight.palette.background);

    setTheme('ink');
    expect(styles.page.backgroundColor).toBe(themes.ink.palette.background);

    // Back again: the first theme's sheet comes from cache, values intact.
    setTheme(DEFAULT_THEME);
    expect(styles.page).toBe(midnightPage);
  });

  it('does the same for plain token maps', () => {
    const tokens = themedTokens(() => ({ ok: colors.success }));
    const before = tokens.ok;

    setTheme('paper');
    expect(tokens.ok).toBe(themes.paper.palette.success);
    expect(tokens.ok).not.toBe(before);
  });

  it('keeps facade keys enumerable so spreads and Object.keys still work', () => {
    const tokens = themedTokens(() => ({ a: colors.text, b: colors.background }));
    expect(Object.keys(tokens).sort()).toEqual(['a', 'b']);
  });
});
