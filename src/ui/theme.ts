import { Platform } from 'react-native';

/** 'Courier' does not exist on Android and silently falls back to sans-serif. */
const MONO_FAMILY = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/**
 * Dark palette, tuned against the background rather than picked by eye.
 * Contrast ratios noted where they're load-bearing; all body text clears
 * WCAG AA (4.5:1) and the accent clears AA on both the page and the button.
 */
export const colors = {
  background: '#0D1117',
  surface: '#161B22',
  surfaceAlt: '#21262D',
  border: '#30363D',

  text: '#E6EDF3', // 14.2:1 on background
  textMuted: '#9198A1', // 6.1:1
  textFaint: '#6E7681', // 3.8:1 — icons, placeholders, disabled only

  /**
   * A bright accent with DARK text on top, rather than a saturated blue with
   * white text. On a dark UI the latter lands around 3:1; this gives 7.9:1 both
   * as a button fill and as standalone link/icon colour.
   */
  primary: '#58A6FF',
  primaryText: '#0B1220',

  success: '#3FB950',
  successSurface: '#12261C',
  warning: '#D29922',
  warningSurface: '#2B2412',
  danger: '#F85149',
  dangerSurface: '#2D1618',

  // Kept darker than `surface` so code blocks still read as inset.
  code: '#010409',
  codeText: '#C9D1D9',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 16, fontWeight: '400' },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '400' },
  smallStrong: { fontSize: 13, fontWeight: '600' },
  mono: { fontSize: 12, fontFamily: MONO_FAMILY },
} as const;
