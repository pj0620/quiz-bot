import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme';

type Props = {
  /** 0..1, clamped. */
  value: number;
  height?: number;
  color?: string;
  trackColor?: string;
};

export function ProgressBar({ value, height = 8, color = colors.primary, trackColor = colors.surfaceAlt }: Props) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height, backgroundColor: trackColor, borderRadius: height / 2 }]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden', borderRadius: radius.pill },
});
