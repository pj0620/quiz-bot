import { colors } from '../theme';

/**
 * Shared native-stack options.
 *
 * Previously copy-pasted verbatim into both `app/_layout.tsx` and
 * `app/connect/github/_layout.tsx`, which meant a theme change had to be made
 * twice and the two drifted apart silently.
 */
export const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTitleStyle: { color: colors.text },
  headerTintColor: colors.primary,
  // The default hairline separator is a light grey that reads as a bright seam
  // against a dark header.
  headerShadowVisible: false,
  // Also the colour behind screens mid-transition — otherwise pushes flash white.
  contentStyle: { backgroundColor: colors.background },
} as const;

/**
 * Full-screen routes that must not be dismissible by accident — the quiz
 * player, where a back-swipe would silently abandon a session in progress.
 */
export const immersiveScreenOptions = {
  headerShown: false,
  gestureEnabled: false,
  presentation: 'fullScreenModal',
  animation: 'slide_from_bottom',
} as const;
