import { colors } from '../theme';

/**
 * Shared native-stack options.
 *
 * Previously copy-pasted verbatim into both `app/_layout.tsx` and
 * `app/connect/github/_layout.tsx`, which meant a theme change had to be made
 * twice and the two drifted apart silently.
 *
 * A FUNCTION now, not a constant. A module-scope object captures the palette's
 * strings once, at import — which was fine while there was one theme and is a
 * stale-colour bug now there are four. Layouts call this during render, where
 * `colors` always holds the active theme (the root remounts on switch).
 */
export function stackScreenOptions() {
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTitleStyle: { color: colors.text },
    headerTintColor: colors.primary,
    // The default hairline separator is a light grey that reads as a bright seam
    // against a dark header.
    headerShadowVisible: false,
    // Also the colour behind screens mid-transition — otherwise pushes flash white.
    contentStyle: { backgroundColor: colors.background },
  } as const;
}

/**
 * Full-screen routes that must not be dismissible by accident — the quiz
 * player, where a back-swipe would silently abandon a session in progress.
 * No colours in it, so it stays a constant.
 */
export const immersiveScreenOptions = {
  headerShown: false,
  gestureEnabled: false,
  presentation: 'fullScreenModal',
  animation: 'slide_from_bottom',
} as const;
