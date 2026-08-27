import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useCrtScreen } from '../terminalFx';

/**
 * The tube the Terminal theme pretends to be drawn on: horizontal scanlines
 * over the whole screen, and a vignette shading the corners the way a curved
 * CRT falls off toward its bezel.
 *
 * `react-native-svg` where `BarChart` refused it — but the dependency is
 * already in the app for the map, and this is one pattern fill plus one radial
 * gradient in a single native view; scanlines as stacked `View`s would be two
 * hundred of them, and a radial vignette is not buildable from rectangles.
 *
 * Deliberately static. A flicker or roll animation would sell the look harder,
 * and would also burn battery on every frame of every screen and bother
 * motion-sensitive readers — the one part of the illusion not worth its cost.
 *
 * Self-gating: renders nothing unless the Terminal theme is active AND the
 * reader has left "CRT screen" on, so mounting it is always safe. It sits in
 * the root layout, over the navigator — which native MODAL routes escape (they
 * present in their own container above the root view), so modal screens mount
 * their own copy. Never mount it anywhere else, or scanlines double up.
 */
export function CrtOverlay() {
  const on = useCrtScreen();
  if (!on) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          {/*
            A 1.4dp dark band every 4dp. Softer than true black bands: the
            palette was contrast-tested WITHOUT this overlay, so it must dim
            the rows it crosses, not extinguish them.
          */}
          <Pattern id="crt-scanlines" width="4" height="4" patternUnits="userSpaceOnUse">
            <Rect x="0" y="2.6" width="4" height="1.4" fill="rgba(0, 0, 0, 0.28)" />
          </Pattern>
          <RadialGradient id="crt-vignette" cx="50%" cy="50%" r="72%">
            <Stop offset="55%" stopColor="#000000" stopOpacity="0" />
            <Stop offset="88%" stopColor="#000000" stopOpacity="0.22" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0.5" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#crt-scanlines)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#crt-vignette)" />
      </Svg>
    </View>
  );
}
