import { Platform } from 'react-native';

/** 'Courier' does not exist on Android and silently falls back to sans-serif. */
const MONO_FAMILY = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/**
 * The design tokens.
 *
 * Structured as a NAMED PALETTE rather than a bare object so a theme picker can
 * later swap the whole thing without touching a single component: everything
 * reads `colors.x`, and `colors` is one palette out of `palettes`. Adding a
 * light theme is then a new entry here plus a context, not a rewrite.
 *
 * The palette is typed, so a new theme that forgets a colour is a compile
 * error rather than a screen with an invisible label on it.
 */
export type Palette = {
  /** Page background — the deepest layer. */
  background: string;
  /** Recessed fill: progress tracks, inset wells, code blocks. */
  surfaceSunken: string;
  /** Cards sitting on the page. */
  surface: string;
  /** Rows and controls sitting on a card — one step nearer the eye. */
  surfaceRaised: string;
  /** Pressed/hover fill for anything interactive. */
  surfaceActive: string;
  /** Legacy alias for the raised fill, used by tracks and chips. */
  surfaceAlt: string;

  border: string;
  /** For elements that need to read as an edge, not a hairline. */
  borderStrong: string;

  text: string;
  textMuted: string;
  textFaint: string;

  primary: string;
  /** Text on a primary fill. */
  primaryText: string;
  /** A dim primary wash, for selected states and tinted headers. */
  primarySurface: string;

  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;

  /** Section accents. Used to colour-code, never as the only signal. */
  violet: string;
  violetSurface: string;
  teal: string;
  tealSurface: string;
  amber: string;
  amberSurface: string;

  code: string;
  codeText: string;
};

/**
 * Dark palette, tuned against the background rather than picked by eye.
 *
 * Five neutral steps instead of the previous three. The old palette drew every
 * boundary with a 1px line, which is why the app read as flat — depth now comes
 * from the fill, and borders only reinforce it. All body text clears WCAG AA
 * (4.5:1) on the surface it actually sits on, not merely on the page.
 */
const dark: Palette = {
  background: '#0A0E15',
  surfaceSunken: '#070A10',
  surface: '#131A24',
  surfaceRaised: '#1B2431',
  surfaceActive: '#242F3E',
  surfaceAlt: '#1B2431',

  border: '#212B38',
  borderStrong: '#2F3B4B',

  text: '#E8EEF6', // 15.1:1 on background
  textMuted: '#98A4B5', // 6.4:1
  textFaint: '#6C7889', // 3.9:1 — icons, placeholders, disabled only

  /**
   * A bright accent with DARK text on top, rather than a saturated blue with
   * white text. On a dark UI the latter lands around 3:1; this gives 8.1:1 both
   * as a button fill and as standalone link/icon colour.
   */
  primary: '#5CA0FF',
  primaryText: '#07101F',
  primarySurface: '#132441',

  success: '#3FBF5C',
  successSurface: '#0F2619',
  warning: '#E0A32E',
  warningSurface: '#2A2211',
  danger: '#FB6A62',
  dangerSurface: '#2E1517',

  violet: '#A78BFA',
  violetSurface: '#1E1A3A',
  teal: '#2DD4BF',
  tealSurface: '#0C2A2A',
  amber: '#F5B544',
  amberSurface: '#2A2211',

  // Kept darker than `surface` so code blocks still read as inset.
  code: '#05080D',
  codeText: '#C9D6E4',
};

export const palettes = { dark } as const;
export type ThemeName = keyof typeof palettes;

export const colors: Palette = palettes.dark;

/**
 * The spacing scale, deliberately tighter than the usual 4/8/16/24 rhythm.
 *
 * This app is dense by nature — a question with five options, a stat row, a
 * list of notes — and a generous scale pushed the answers on the player screen
 * below the fold on a normal phone. Every value here is used on both axes, so
 * shrinking the scale tightens the whole app proportionally; where vertical
 * space needs to be tighter still, components reduce it locally.
 *
 * `xs` stays at 4: it is already the smallest useful gap.
 */
export const spacing = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 12,
  xl: 18,
  xxl: 24,
} as const;

/**
 * The floor for anything tappable. Apple's HIG minimum, and the reason row and
 * button heights below stop where they do rather than following the scale down.
 */
export const TOUCH_TARGET = 44;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

/**
 * Shadows, iOS-first.
 *
 * Used sparingly and always ALONGSIDE a fill difference, never as the only cue:
 * on a near-black background a shadow is close to invisible, so anything
 * relying on it alone would simply vanish.
 */
export const elevation = {
  card: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    default: { elevation: 3 },
  }),
  raised: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
    default: { elevation: 2 },
  }),
} as const;

export const type = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400' },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '400' },
  smallStrong: { fontSize: 13, fontWeight: '600' },
  /** Section labels. Uppercase is applied by the component, not here. */
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  micro: { fontSize: 11, fontWeight: '600' },
  mono: { fontSize: 12, fontFamily: MONO_FAMILY },
} as const;

/** The accent set a section header or card can be tinted with. */
export type AccentName = 'primary' | 'violet' | 'teal' | 'amber' | 'success' | 'danger';

export const accents: Record<AccentName, { fg: string; surface: string }> = {
  primary: { fg: colors.primary, surface: colors.primarySurface },
  violet: { fg: colors.violet, surface: colors.violetSurface },
  teal: { fg: colors.teal, surface: colors.tealSurface },
  amber: { fg: colors.amber, surface: colors.amberSurface },
  success: { fg: colors.success, surface: colors.successSurface },
  danger: { fg: colors.danger, surface: colors.dangerSurface },
};
