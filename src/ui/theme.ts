import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { createStore } from '../lib/createStore';

/** 'Courier' does not exist on Android and silently falls back to sans-serif. */
const MONO_FAMILY = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/**
 * The design tokens.
 *
 * Structured as a NAMED PALETTE rather than a bare object so the theme picker
 * can swap the whole thing without touching a single component: everything
 * reads `colors.x`, and `colors` is one palette out of `themes`.
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

  /**
   * Behind the passage a question was written from.
   *
   * Warm and low-saturation on purpose: it marks prose the reader still has to
   * read, so it has to separate from the surrounding text without competing
   * with it, and it must not be mistaken for the semantic colours above.
   */
  highlightSurface: string;

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
 * Midnight — the original palette, tuned against the background rather than
 * picked by eye.
 *
 * Five neutral steps instead of the previous three. The old palette drew every
 * boundary with a 1px line, which is why the app read as flat — depth now comes
 * from the fill, and borders only reinforce it. All body text clears WCAG AA
 * (4.5:1) on the surface it actually sits on, not merely on the page.
 */
const midnight: Palette = {
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

  highlightSurface: '#3D3416',

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

/**
 * Terminal — green phosphor on black, after the CRT monitors this look is
 * named for. Every colour is a green, because a single-phosphor screen IS the
 * period look: the tube could only vary how hard it drove one dot, so state is
 * carried by brightness (success bright, danger dim), exactly as Ink carries
 * it with greys. Paired with the monospaced type scale, the glow baked into it
 * (see `buildType`), squared corners (see `buildRadius`) and the scanline
 * overlay, the whole app sets like a program running on that machine.
 *
 * Single-hue also makes the glyph glow safe everywhere: the one dark-on-bright
 * pairing (`primaryText` on `primary`) hides a green halo against its own
 * green fill.
 */
const terminal: Palette = {
  background: '#041104',
  surfaceSunken: '#010801',
  surface: '#0A1F0A',
  surfaceRaised: '#0F2C0F',
  surfaceActive: '#164016',
  surfaceAlt: '#0F2C0F',

  // Bright enough to read as drawn box-lines, not modern hairlines.
  border: '#1C5A1C',
  borderStrong: '#2FA02F',

  text: '#33FF33', // 14.3:1 on background
  textMuted: '#28C428', // 8.3:1
  textFaint: '#1E8A1E',

  // The inverted block of a selected terminal cell: full-brightness green
  // fill, screen-black text.
  primary: '#33FF33',
  primaryText: '#031403',
  primarySurface: '#0C330C',

  success: '#7DFF7D',
  successSurface: '#103D10',
  warning: '#2FD62F',
  warningSurface: '#123412',
  danger: '#1FA51F',
  dangerSurface: '#0B2B0B',

  highlightSurface: '#153815',

  violet: '#8AFF8A',
  violetSurface: '#123D12',
  teal: '#5CE65C',
  tealSurface: '#0E380E',
  amber: '#47D147',
  amberSurface: '#0C300C',

  // Code sinks to the pure-black tube glass — a screen within the screen.
  code: '#000000',
  codeText: '#33FF33',
};

/**
 * Ink — strict black and white. No hue anywhere: state is carried by
 * brightness (success bright, danger dim) and by the labels themselves, which
 * every semantic surface in the app already pairs with its colour. Built for
 * OLED and for people who want the quiz, not the dashboard.
 */
const ink: Palette = {
  background: '#000000',
  surfaceSunken: '#050505',
  surface: '#161616',
  surfaceRaised: '#222222',
  surfaceActive: '#2E2E2E',
  surfaceAlt: '#222222',

  border: '#2F2F2F',
  borderStrong: '#525252',

  text: '#FFFFFF',
  textMuted: '#ACACAC',
  textFaint: '#6F6F6F',

  primary: '#FFFFFF',
  primaryText: '#000000',
  primarySurface: '#242424',

  success: '#F2F2F2',
  successSurface: '#262626',
  warning: '#CFCFCF',
  warningSurface: '#1E1E1E',
  danger: '#8A8A8A',
  dangerSurface: '#111111',

  highlightSurface: '#3A3A3A',

  violet: '#E8E8E8',
  violetSurface: '#202020',
  teal: '#D6D6D6',
  tealSurface: '#1B1B1B',
  amber: '#C4C4C4',
  amberSurface: '#181818',

  code: '#0A0A0A',
  codeText: '#EDEDED',
};

/**
 * Paper — warm off-white with ink-blue accents; the app's one light theme.
 * Surfaces get LIGHTER toward the eye here (cards are white on cream), the
 * exact inverse of the dark themes, which is what `surfaceRaised` and friends
 * being tokens rather than computed shades buys.
 */
const paper: Palette = {
  background: '#F6F1E7',
  surfaceSunken: '#ECE5D6',
  surface: '#FFFFFF',
  surfaceRaised: '#F3EDE0',
  surfaceActive: '#E9E1CE',
  surfaceAlt: '#F3EDE0',

  border: '#DCD3BF',
  borderStrong: '#C3B79D',

  text: '#2B2416',
  textMuted: '#6B5F49',
  textFaint: '#9A8F78',

  primary: '#1F5AA8',
  primaryText: '#FFFFFF',
  primarySurface: '#E1EAF6',

  success: '#2E7D32',
  successSurface: '#E2EFE0',
  warning: '#8A6100',
  warningSurface: '#F4EACF',
  danger: '#B23A2E',
  dangerSurface: '#F6E2DE',

  highlightSurface: '#F3E6B8',

  violet: '#6A4FB6',
  violetSurface: '#EAE5F6',
  teal: '#0E756D',
  tealSurface: '#DDEEEC',
  amber: '#B45309',
  amberSurface: '#F5E8D2',

  code: '#EBE4D2',
  codeText: '#4A3F2A',
};

/**
 * XP — Windows XP's Luna, the Bliss-era desktop: warm `#ECE9D8` dialog beige
 * for the ground, white list-view windows on top of it, and the title-bar
 * blue as the accent. The greys are XP's own 3D-edge greys (`#ACA899`), the
 * field borders the blue-grey every XP text box wore, and the highlight the
 * tooltip yellow. Green and red keep their Luna voices (Start-button green,
 * error-dialog red). Paired with the Verdana type and the tight corner scale
 * below — Luna rounded a button 3px, not 14 — so it reads as drawn by that
 * machine, not merely coloured like it.
 */
const xp: Palette = {
  background: '#ECE9D8',
  surfaceSunken: '#E2DEC9',
  surface: '#FFFFFF',
  surfaceRaised: '#F1EFE2',
  surfaceActive: '#DCE4F5',
  surfaceAlt: '#F1EFE2',

  border: '#ACA899',
  borderStrong: '#7F9DB9',

  text: '#1C1A15', // 13.9:1 on background
  textMuted: '#6B675C', // 4.6:1
  textFaint: '#918C7D',

  // The Luna title-bar blue, white text on it exactly as the caption bar had.
  primary: '#0054E3',
  primaryText: '#FFFFFF',
  primarySurface: '#D6E5F8',

  success: '#2F7D2F',
  successSurface: '#DFEED8',
  warning: '#8A6100',
  warningSurface: '#F7ECC5',
  danger: '#C42B1C',
  dangerSurface: '#F7DEDA',

  highlightSurface: '#F5EDB8',

  violet: '#6A4FB6',
  violetSurface: '#E9E4F6',
  teal: '#0E756D',
  tealSurface: '#DCEEEB',
  amber: '#B45309',
  amberSurface: '#F5E8CF',

  code: '#E9E5D2',
  codeText: '#47412C',
};

/**
 * Amber — Terminal's sibling tube, driven by the OTHER phosphor: P3 amber,
 * the long-persistence orange of a WYSE or DEC monitor. Everything Terminal's
 * palette comment says holds here verbatim — single hue because a
 * single-phosphor screen IS the period look, state carried by brightness,
 * the one dark-on-bright pairing hiding its halo against its own fill — only
 * the phosphor changes. The CRT rig (scanlines, typewriter, squared corners)
 * follows the `crt` flag, so this theme inherits all of it unchanged.
 */
const amber: Palette = {
  background: '#160E02',
  surfaceSunken: '#0B0701',
  surface: '#241804',
  surfaceRaised: '#33220A',
  surfaceActive: '#46300E',
  surfaceAlt: '#33220A',

  border: '#5E4410',
  borderStrong: '#A87818',

  text: '#FFB000', // 10.2:1 on background
  textMuted: '#CC8C0A', // 6.5:1
  textFaint: '#8F6208',

  primary: '#FFB000',
  primaryText: '#1A1002',
  primarySurface: '#3D2A05',

  success: '#FFD34D',
  successSurface: '#3D2F06',
  warning: '#E09A10',
  warningSurface: '#332406',
  danger: '#B37400',
  dangerSurface: '#2B1D04',

  highlightSurface: '#3A2C08',

  violet: '#FFC96B',
  violetSurface: '#3C2C08',
  teal: '#F0A830',
  tealSurface: '#362708',
  amber: '#D98E00',
  amberSurface: '#302104',

  code: '#000000',
  codeText: '#FFB000',
};

/**
 * Game Boy — the four shades of the DMG-01's olive LCD, the machine that
 * called them "4 shades of gray". The famous quartet (#0F380F, #306230,
 * #8BAC0F, #9BBC0F) can't fill a five-step neutral ladder plus accents by
 * itself, so the extra steps are interpolated inside the same gamut — the
 * Ink precedent, in green. The light retro theme: the GROUND is the lit
 * screen, and everything on it is darker ink. State is carried by darkness
 * (success darkest, danger washed) and by labels. LCD, not tube: squared
 * corners without the `crt` scanlines.
 */
const gameboy: Palette = {
  background: '#8BAC0F',
  surfaceSunken: '#7A9A0D',
  surface: '#9BBC0F',
  surfaceRaised: '#A6C51C',
  surfaceActive: '#B2CE33',
  surfaceAlt: '#A6C51C',

  border: '#306230',
  borderStrong: '#0F380F',

  text: '#0F380F', // 5.0:1 on background
  textMuted: '#1E4E1A', // 3.6:1
  textFaint: '#38683A',

  primary: '#0F380F',
  primaryText: '#9BBC0F',
  primarySurface: '#7C9C10',

  success: '#12400F',
  successSurface: '#A3C22F',
  warning: '#2A5426',
  warningSurface: '#90AF14',
  danger: '#3F6B33',
  dangerSurface: '#85A311',

  highlightSurface: '#B7CE4A',

  violet: '#1C4A18',
  violetSurface: '#A2C12A',
  teal: '#265323',
  tealSurface: '#97B81C',
  amber: '#33602D',
  amberSurface: '#8FB013',

  code: '#8FB013',
  codeText: '#0F380F',
};

/**
 * Hotdog Stand — the Windows 3.1 colour scheme so notorious it became the
 * unit of bad taste, reproduced with a straight face. Ground and cards are
 * the reds, the primary is the mustard-yellow with black text (15:1 — the
 * scheme was loud, not unreadable), and everything else is red-tinted white
 * or yellow. On an all-red screen no colour can mean "danger", so state is
 * carried by brightness and labels, the Ink/Terminal precedent. Corners
 * square, as Program Manager drew them.
 */
const hotdog: Palette = {
  background: '#A50E0E',
  surfaceSunken: '#8C0A0A',
  surface: '#C41414',
  surfaceRaised: '#D62121',
  surfaceActive: '#E63232',
  surfaceAlt: '#D62121',

  border: '#800A0A',
  borderStrong: '#330000',

  text: '#FFFFFF', // 7.9:1 on background
  textMuted: '#FFD1CE', // 5.7:1
  textFaint: '#E89B96',

  primary: '#FFD500',
  primaryText: '#000000',
  primarySurface: '#4A3B00',

  success: '#FFE066',
  successSurface: '#5C4A00',
  warning: '#FFD500',
  warningSurface: '#52420A',
  danger: '#FFB3AB',
  dangerSurface: '#6E0505',

  highlightSurface: '#8A5200',

  violet: '#FFC2BD',
  violetSurface: '#750808',
  teal: '#FFE9A8',
  tealSurface: '#66500A',
  amber: '#FFD500',
  amberSurface: '#5C4A00',

  code: '#3D0303',
  codeText: '#FFD98F',
};

/**
 * System 7 — a classic Macintosh in its Platinum grays: 1-bit black type on
 * white windows over the desktop gray, with black-fill inverse video for the
 * primary, exactly how a selected menu item looked. Ink's light twin: no hue
 * anywhere, state carried by darkness (success strongest, danger washed) and
 * by labels. The corner scale is the classic Mac rounded rect — small radii
 * everywhere and only a modest one on "pills", because the platinum era
 * rounded corners politely, never fully.
 */
const system7: Palette = {
  background: '#EDEDED',
  surfaceSunken: '#DBDBDB',
  surface: '#FFFFFF',
  surfaceRaised: '#E4E4E4',
  surfaceActive: '#D2D2D2',
  surfaceAlt: '#E4E4E4',

  border: '#8F8F8F',
  borderStrong: '#111111',

  text: '#000000', // 17.9:1 on background
  textMuted: '#525252', // 6.7:1
  textFaint: '#8C8C8C',

  primary: '#000000',
  primaryText: '#FFFFFF',
  primarySurface: '#DCDCDC',

  success: '#1C1C1C',
  successSurface: '#E9E9E9',
  warning: '#3D3D3D',
  warningSurface: '#E0E0E0',
  danger: '#757575',
  dangerSurface: '#F2F2F2',

  highlightSurface: '#D8D8D8',

  violet: '#2A2A2A',
  violetSurface: '#E6E6E6',
  teal: '#404040',
  tealSurface: '#E2E2E2',
  amber: '#5A5A5A',
  amberSurface: '#DEDEDE',

  code: '#E2E2E2',
  codeText: '#333333',
};

/**
 * Synthwave — indigo night with a neon-pink sign buzzing over it. The first
 * theme to use `glow` OUTSIDE the CRT rig: the bloom is a neon tube's, not a
 * phosphor's, so it comes with modern corners and the system face rather
 * than scanlines and monospace. Pink leads, cyan and violet answer it, and
 * the semantic colours stay recognisable (green success, red danger) but
 * neon-bright, because on this street every sign is lit.
 */
const synthwave: Palette = {
  background: '#150A2E',
  surfaceSunken: '#0D0620',
  surface: '#1F1142',
  surfaceRaised: '#2A1858',
  surfaceActive: '#37216E',
  surfaceAlt: '#2A1858',

  border: '#3B2878',
  borderStrong: '#5C3FAE',

  text: '#F2EBFF', // 13.1:1 on background
  textMuted: '#B8A3E8', // 7.9:1
  textFaint: '#8268BE',

  primary: '#FF5EDB',
  primaryText: '#2B0A24',
  primarySurface: '#3E1440',

  success: '#4AE8A4',
  successSurface: '#0E3A2C',
  warning: '#FFC84A',
  warningSurface: '#3D2E10',
  danger: '#FF6B8B',
  dangerSurface: '#46101F',

  highlightSurface: '#3D3418',

  violet: '#B18CFF',
  violetSurface: '#2B1A54',
  teal: '#29E6FF',
  tealSurface: '#0B3442',
  amber: '#FFB35C',
  amberSurface: '#3C2810',

  code: '#0A0518',
  codeText: '#C9BCF2',
};

/**
 * Broadsheet — a morning paper: newsprint white, true-black ink, and one
 * masthead-red accent doing all the shouting, with the rest of the accents
 * kept inky and reserved. Paired with the Georgia type below, because the
 * serif IS the theme — the same mechanism that gives XP its Verdana. Print
 * draws rules and boxes, not rounded cards, so the corner scale is zeroed:
 * chips become the square little section tags a paper actually sets.
 */
const broadsheet: Palette = {
  background: '#FAF7F0',
  surfaceSunken: '#EEE9DD',
  surface: '#FFFFFF',
  surfaceRaised: '#F3EFE5',
  surfaceActive: '#E8E2D2',
  surfaceAlt: '#F3EFE5',

  border: '#D9D3C4',
  borderStrong: '#8A8272',

  text: '#171410', // 17.4:1 on background
  textMuted: '#5C564A', // 6.8:1
  textFaint: '#8E8778',

  primary: '#B01F24',
  primaryText: '#FFFFFF',
  primarySurface: '#F5DFDD',

  success: '#2F6B36',
  successSurface: '#E4EEE0',
  warning: '#8A6100',
  warningSurface: '#F4ECCF',
  danger: '#A2261F',
  dangerSurface: '#F6E0DC',

  highlightSurface: '#F3E9BC',

  violet: '#54488A',
  violetSurface: '#E9E6F4',
  teal: '#25655F',
  tealSurface: '#DFEDEA',
  amber: '#95560E',
  amberSurface: '#F2E6D0',

  code: '#EFEBDF',
  codeText: '#454034',
};

/**
 * Solarized — Ethan Schoonover's dark half, on base03/base02 with the eight
 * canonical accents mapped onto this app's slots (green success, yellow
 * warning, red danger, violet, cyan teal, orange amber). One honest
 * departure: canonical base0 body text (#839496) fails WCAG AA on base02
 * surfaces, so body text is lifted toward base2 while keeping the hue —
 * Solarized as specified is a terminal palette, and this is a phone in
 * daylight. Blue keeps dark text on its fill for the same reason (the
 * Midnight trick): white on #268BD2 lands under 4:1.
 */
const solarized: Palette = {
  background: '#002B36',
  surfaceSunken: '#00212B',
  surface: '#073642',
  surfaceRaised: '#0A4152',
  surfaceActive: '#0E4C5F',
  surfaceAlt: '#0A4152',

  border: '#12505F',
  borderStrong: '#586E75',

  text: '#B8C4C2', // 8.4:1 on background
  textMuted: '#7E969B', // 4.8:1
  textFaint: '#586E75',

  primary: '#268BD2',
  primaryText: '#00161C',
  primarySurface: '#0B3D54',

  success: '#859900',
  successSurface: '#1D3009',
  warning: '#B58900',
  warningSurface: '#332B09',
  danger: '#DC322F',
  dangerSurface: '#3A1417',

  highlightSurface: '#3A3512',

  violet: '#6C71C4',
  violetSurface: '#1C2144',
  teal: '#2AA198',
  tealSurface: '#0B3534',
  amber: '#CB4B16',
  amberSurface: '#38200D',

  code: '#00181F',
  codeText: '#93A1A1',
};

/**
 * Nord — the arctic palette: Polar Night for the neutral ladder, Snow Storm
 * for the type, Frost's blue-green for the primary (dark text on it — the
 * frost blues are too light to carry white), and the Aurora reds, greens and
 * yellows for the semantics, each over a dim wash of itself. The tasteful
 * modern dark, for readers who find Midnight's blue too blue.
 */
const nord: Palette = {
  background: '#2E3440',
  surfaceSunken: '#272C36',
  surface: '#3B4252',
  surfaceRaised: '#434C5E',
  surfaceActive: '#4C566A',
  surfaceAlt: '#434C5E',

  border: '#4C566A',
  borderStrong: '#616E88',

  text: '#ECEFF4', // 10.8:1 on background
  textMuted: '#AEB8CA', // 6.2:1
  textFaint: '#7B879D',

  primary: '#88C0D0',
  primaryText: '#121A24',
  primarySurface: '#2B4552',

  success: '#A3BE8C',
  successSurface: '#37402F',
  warning: '#EBCB8B',
  warningSurface: '#453A25',
  danger: '#BF616A',
  dangerSurface: '#432730',

  highlightSurface: '#4A4028',

  violet: '#B48EAD',
  violetSurface: '#3F3242',
  teal: '#8FBCBB',
  tealSurface: '#2C4342',
  amber: '#D08770',
  amberSurface: '#472F26',

  code: '#232831',
  codeText: '#D8DEE9',
};

export type ThemeName =
  | 'midnight'
  | 'ink'
  | 'nord'
  | 'solarized'
  | 'synthwave'
  | 'paper'
  | 'broadsheet'
  | 'system7'
  | 'xp'
  | 'terminal'
  | 'amber'
  | 'gameboy'
  | 'hotdog';

export type ThemeDefinition = {
  name: ThemeName;
  label: string;
  /** One line for the picker. Say what it looks like, not what it's "for". */
  description: string;
  palette: Palette;
  /** Sets the ENTIRE type scale in the monospace family. The vintage half of Terminal. */
  monospaced: boolean;
  /**
   * The full CRT treatment: corners square off (`buildRadius`) and the
   * opt-in screen effects (scanline overlay, typewriter prompts) become
   * available. Terminal only — the other themes must not change.
   */
  crt: boolean;
  /** Every glyph blooms in this colour, via the type scale. Phosphor, in css. */
  glow?: string;
  /**
   * Sets the ENTIRE type scale in this family, the way `monospaced` does for
   * the mono family (which wins if both are set — mono IS the point there).
   * The `mono`/code token is not touched: code stays code in every theme.
   */
  fontFamily?: string;
  /**
   * A corner scale of the theme's own, for a period look the modern scale
   * would betray — XP rounded a button 3px. `crt` still squares everything
   * to zero; themes without an opinion get the modern default.
   */
  radii?: RadiusScale;
  /** Status-bar content that stays readable on `palette.background`. */
  statusBar: 'light' | 'dark';
};

/**
 * Record order is picker order. Loosely grouped so thirteen rows scan:
 * the dark palettes, the light palettes, then the machines.
 */
export const themes: Record<ThemeName, ThemeDefinition> = {
  midnight: {
    name: 'midnight',
    label: 'Midnight',
    description: 'Deep blue-black with a bright blue accent. The original.',
    palette: midnight,
    monospaced: false,
    crt: false,
    statusBar: 'light',
  },
  ink: {
    name: 'ink',
    label: 'Ink',
    description: 'Pure black and white. No colour anywhere.',
    palette: ink,
    monospaced: false,
    crt: false,
    statusBar: 'light',
  },
  nord: {
    name: 'nord',
    label: 'Nord',
    description: 'Arctic slate blue with frost and aurora accents.',
    palette: nord,
    monospaced: false,
    crt: false,
    statusBar: 'light',
  },
  solarized: {
    name: 'solarized',
    label: 'Solarized',
    description: 'The famous blue-green dark, canonical accents and all.',
    palette: solarized,
    monospaced: false,
    crt: false,
    statusBar: 'light',
  },
  synthwave: {
    name: 'synthwave',
    label: 'Synthwave',
    description: 'Neon pink glowing over indigo night. An 80s that never happened.',
    palette: synthwave,
    monospaced: false,
    crt: false,
    // A neon tube's bloom, not a phosphor's: glow without the CRT rig.
    glow: 'rgba(255, 94, 219, 0.45)',
    statusBar: 'light',
  },
  paper: {
    name: 'paper',
    label: 'Paper',
    description: 'Warm cream and ink blue. The light option.',
    palette: paper,
    monospaced: false,
    crt: false,
    statusBar: 'dark',
  },
  broadsheet: {
    name: 'broadsheet',
    label: 'Broadsheet',
    description: 'Newsprint white and serif black with one masthead-red accent.',
    palette: broadsheet,
    monospaced: false,
    crt: false,
    // The serif is the theme. Georgia ships on iOS; elsewhere, system face.
    fontFamily: Platform.select({ ios: 'Georgia', default: undefined }),
    // Print draws rules and boxes; nothing on a broadsheet page is rounded.
    radii: { sm: 0, md: 0, lg: 0, xl: 0, pill: 0 },
    statusBar: 'dark',
  },
  system7: {
    name: 'system7',
    label: 'System 7',
    description: 'Platinum and 1-bit black on white, like a classic Macintosh.',
    palette: system7,
    monospaced: false,
    crt: false,
    // The classic Mac rounded rect: polite small radii, pills included.
    radii: { sm: 3, md: 4, lg: 5, xl: 6, pill: 8 },
    statusBar: 'dark',
  },
  xp: {
    name: 'xp',
    label: 'Windows XP',
    description: 'Luna: title-bar blue on warm beige, white windows. It is 2001.',
    palette: xp,
    monospaced: false,
    crt: false,
    // Tahoma is what Luna actually wore, but iOS does not ship it; Verdana is
    // the same designer's screen face and does. Elsewhere, no override — the
    // system face beats a sans that only resembles the wrong one.
    fontFamily: Platform.select({ ios: 'Verdana', default: undefined }),
    // Luna's corners: 3px controls, 8px window tops, nothing remotely a pill —
    // XP's "pills" (taskbar buttons, chips) were 4px rectangles.
    radii: { sm: 2, md: 3, lg: 6, xl: 8, pill: 4 },
    statusBar: 'dark',
  },
  terminal: {
    name: 'terminal',
    label: 'Terminal',
    description: 'Glowing green phosphor on black, all monospace — a program on an old CRT.',
    palette: terminal,
    monospaced: true,
    crt: true,
    // Alpha keeps the bloom a haze rather than a second glyph behind the first.
    glow: 'rgba(51, 255, 51, 0.55)',
    statusBar: 'light',
  },
  amber: {
    name: 'amber',
    label: 'Amber',
    description: 'The other phosphor: glowing amber on black, same CRT, same monospace.',
    palette: amber,
    monospaced: true,
    crt: true,
    glow: 'rgba(255, 176, 0, 0.55)',
    statusBar: 'light',
  },
  gameboy: {
    name: 'gameboy',
    label: 'Game Boy',
    description: 'The four olive-green shades of the original handheld LCD.',
    palette: gameboy,
    monospaced: true,
    crt: false,
    // An LCD has hard square cells but no scanlines: corners without the rig.
    radii: { sm: 0, md: 0, lg: 0, xl: 0, pill: 0 },
    statusBar: 'dark',
  },
  hotdog: {
    name: 'hotdog',
    label: 'Hotdog Stand',
    description: 'Red, yellow, black. The infamous Windows 3.1 scheme, worn proudly.',
    palette: hotdog,
    monospaced: false,
    crt: false,
    // Program Manager drew rectangles.
    radii: { sm: 0, md: 0, lg: 0, xl: 0, pill: 0 },
    statusBar: 'light',
  },
};

export const DEFAULT_THEME: ThemeName = 'midnight';

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in themes;
}

export function listThemes(): ThemeDefinition[] {
  return Object.values(themes);
}

/**
 * Which theme is active.
 *
 * Deliberately holds only the NAME, and deliberately knows nothing about
 * persistence: kv-backed storage cannot even be imported under jest, and this
 * module is imported by every component there is. Hydration and saving live in
 * `themePersistence.ts`, which only the app's root layout pulls in.
 */
export const themeStore = createStore<ThemeName>(DEFAULT_THEME);

export function useThemeName(): ThemeName {
  return themeStore.use();
}

export function getTheme(): ThemeDefinition {
  return themes[themeStore.get()];
}

/**
 * Applies a theme by MUTATING the exported token objects in place.
 *
 * This is the load-bearing trick of the whole theme system, so it is worth
 * being explicit about. Every component reads `colors.x` / `type.x` at render
 * time, and the root layout remounts the tree (via `key`) when the theme
 * changes — so render-time reads pick up the new values with no component
 * changes at all. The one thing mutation cannot reach is a style sheet built
 * at module scope, which captured the old strings when its module was first
 * evaluated: those go through `themedSheet` below, which rebuilds per theme.
 *
 * Mutate BEFORE notifying, or subscribers re-render against the old tokens.
 */
export function setTheme(name: ThemeName): void {
  if (themeStore.get() === name) return;
  const theme = themes[name];
  Object.assign(colors, theme.palette);
  Object.assign(type, buildType(theme.monospaced, theme.glow, theme.fontFamily));
  Object.assign(accents, buildAccents(theme.palette));
  Object.assign(radius, buildRadius(theme));
  themeStore.set(name);
}

export const colors: Palette = { ...themes[DEFAULT_THEME].palette };

/**
 * A style sheet that follows the theme.
 *
 * A drop-in wrapper for module-scope `StyleSheet.create`: the builder runs
 * lazily, once per theme, reading whatever `colors`/`type` hold at that
 * moment, and the returned object serves the active theme's sheet through
 * property getters — so `styles.foo` at render time is always the current
 * theme's style. Callers change one line and keep every `styles.x` reference:
 *
 *   const styles = themedSheet(() => ({ root: { backgroundColor: colors.background } }));
 *
 * The keys are enumerated from the first build, which is safe because a
 * builder's shape cannot vary by theme — it is a single object literal.
 */
export function themedSheet<T extends StyleSheet.NamedStyles<T>>(build: () => T): T {
  const cache = new Map<ThemeName, T>();

  const resolve = (): T => {
    const name = themeStore.get();
    let sheet = cache.get(name);
    if (!sheet) {
      sheet = StyleSheet.create(build());
      cache.set(name, sheet);
    }
    return sheet;
  };

  const facade = {} as T;
  for (const key of Object.keys(resolve())) {
    Object.defineProperty(facade, key, {
      enumerable: true,
      get: () => resolve()[key as keyof T],
    });
  }
  return facade;
}

/**
 * `themedSheet` for plain token maps — the `Record<Tone, string>` lookup
 * tables components keep at module scope. Same lazy per-theme rebuild, same
 * getter facade, no `StyleSheet.create`.
 */
export function themedTokens<T extends Record<string, unknown>>(build: () => T): T {
  const cache = new Map<ThemeName, T>();

  const resolve = (): T => {
    const name = themeStore.get();
    let tokens = cache.get(name);
    if (!tokens) {
      tokens = build();
      cache.set(name, tokens);
    }
    return tokens;
  };

  const facade = {} as T;
  for (const key of Object.keys(resolve())) {
    Object.defineProperty(facade, key, {
      enumerable: true,
      get: () => resolve()[key as keyof T],
    });
  }
  return facade;
}

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

export type RadiusScale = Record<'sm' | 'md' | 'lg' | 'xl' | 'pill', number>;

/**
 * Corner radii — themed, because period looks live or die on corners.
 *
 * Rounded rectangles are a firmly post-phosphor idea; a terminal drew cells,
 * and even its "pills" (chips, badges) were inverse-video rectangles. Zeroing
 * the whole scale is what makes Terminal read as drawn BY that machine rather
 * than skinned to resemble one. A theme can instead bring its own scale
 * (`radii` — XP's 2–8px), and everything else keeps the modern default.
 */
function buildRadius(theme: ThemeDefinition): RadiusScale {
  if (theme.crt) return { sm: 0, md: 0, lg: 0, xl: 0, pill: 0 };
  if (theme.radii) return { ...theme.radii };
  return { sm: 6, md: 10, lg: 14, xl: 18, pill: 999 };
}

export const radius: RadiusScale = buildRadius(themes[DEFAULT_THEME]);

/**
 * Shadows, iOS-first.
 *
 * Used sparingly and always ALONGSIDE a fill difference, never as the only cue:
 * on a near-black background a shadow is close to invisible, so anything
 * relying on it alone would simply vanish. Not themed: a soft black shadow
 * reads correctly on every palette, light ones included.
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

type TypeToken = {
  fontSize: number;
  fontWeight?: TextStyle['fontWeight'];
  letterSpacing?: number;
  fontFamily?: string;
  textShadowColor?: string;
  textShadowOffset?: { width: number; height: number };
  textShadowRadius?: number;
};

export type TypeScale = Record<
  'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'smallStrong' | 'overline' | 'micro' | 'mono',
  TypeToken
>;

/**
 * The type scale — and the second half of what a theme can change.
 *
 * `monospaced` sets every token in the mono family and zeroes the negative
 * tracking (tightened letterspacing is a trick for grotesque display faces;
 * on a fixed-pitch face it just makes glyphs collide). `family` does the same
 * swap into a named face (XP's Verdana) without touching the tracking; the
 * mono flag wins if both are set. Sizes and weights stay put across themes,
 * so nothing reflows further than the wider glyphs demand.
 *
 * `glow` bakes a zero-offset text shadow into every token — phosphor bloom,
 * scaled to the glyph (a 34px character excites more of the tube than an 11px
 * one). In the type scale rather than per-component so every character in the
 * app glows without a single component change; safe only because Terminal's
 * glow is its own hue on its own single-hue screen (see the palette comment).
 */
function buildType(monospaced: boolean, glow?: string, uiFamily?: string): TypeScale {
  const family = monospaced ? { fontFamily: MONO_FAMILY } : uiFamily ? { fontFamily: uiFamily } : {};
  const track = (value: number) => (monospaced ? {} : { letterSpacing: value });
  const bloom = (spread: number) =>
    glow
      ? { textShadowColor: glow, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: spread }
      : {};

  return {
    display: { fontSize: 34, fontWeight: '800', ...track(-0.6), ...family, ...bloom(10) },
    title: { fontSize: 28, fontWeight: '700', ...track(-0.4), ...family, ...bloom(9) },
    heading: { fontSize: 20, fontWeight: '700', ...track(-0.2), ...family, ...bloom(8) },
    body: { fontSize: 16, fontWeight: '400', ...family, ...bloom(6) },
    bodyStrong: { fontSize: 16, fontWeight: '600', ...family, ...bloom(6) },
    small: { fontSize: 13, fontWeight: '400', ...family, ...bloom(5) },
    smallStrong: { fontSize: 13, fontWeight: '600', ...family, ...bloom(5) },
    /** Section labels. Uppercase is applied by the component, not here. */
    overline: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, ...family, ...bloom(4) },
    micro: { fontSize: 11, fontWeight: '600', ...family, ...bloom(4) },
    mono: { fontSize: 12, fontFamily: MONO_FAMILY, ...bloom(5) },
  };
}

export const type: TypeScale = buildType(
  themes[DEFAULT_THEME].monospaced,
  themes[DEFAULT_THEME].glow,
  themes[DEFAULT_THEME].fontFamily,
);

/** The accent set a section header or card can be tinted with. */
export type AccentName = 'primary' | 'violet' | 'teal' | 'amber' | 'success' | 'danger';

function buildAccents(palette: Palette): Record<AccentName, { fg: string; surface: string }> {
  return {
    primary: { fg: palette.primary, surface: palette.primarySurface },
    violet: { fg: palette.violet, surface: palette.violetSurface },
    teal: { fg: palette.teal, surface: palette.tealSurface },
    amber: { fg: palette.amber, surface: palette.amberSurface },
    success: { fg: palette.success, surface: palette.successSurface },
    danger: { fg: palette.danger, surface: palette.dangerSurface },
  };
}

export const accents: Record<AccentName, { fg: string; surface: string }> = buildAccents(
  themes[DEFAULT_THEME].palette,
);
