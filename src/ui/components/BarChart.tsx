import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

export type Bar = {
  /** Drives the height, relative to the largest value in the set. */
  value: number;
  /** Under the bar. Kept to 1-2 characters — space is tight. */
  label: string;
  /** Emphasised bar, e.g. today. */
  highlight?: boolean;
};

type Props = {
  bars: Bar[];
  height?: number;
  /** Shown above the tallest bar so the scale is readable. */
  maxLabel?: string;
  emptyMessage?: string;
};

/**
 * A column chart built from Views.
 *
 * No `react-native-svg` on purpose: it is the only dependency the whole UI
 * would need a native module for, and bars are rectangles. Heights are
 * percentages of the tallest bar, so the chart scales itself.
 */
export function BarChart({ bars, height = 90, maxLabel, emptyMessage }: Props) {
  const max = Math.max(...bars.map((bar) => bar.value), 0);

  if (bars.length === 0 || max === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>{emptyMessage ?? 'Nothing yet'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {maxLabel ? <Text style={styles.max}>{maxLabel}</Text> : null}
      <View style={[styles.plot, { height }]}>
        {bars.map((bar, index) => (
          <View key={index} style={styles.column}>
            <View style={styles.barTrack}>
              {/*
                A floor of 2pt on any non-zero bar: a single review on a day
                that also contains a 40-review day would otherwise round to
                nothing and read as "didn't study".
              */}
              <View
                style={[
                  styles.bar,
                  bar.highlight && styles.highlight,
                  { height: bar.value === 0 ? 0 : Math.max(2, (bar.value / max) * height) },
                ]}
              />
            </View>
            <Text style={[styles.label, bar.highlight && styles.highlightLabel]} numberOfLines={1}>
              {bar.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  max: { ...type.small, color: colors.textFaint },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  column: { flex: 1, alignItems: 'center', gap: spacing.xs, height: '100%', justifyContent: 'flex-end' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm },
  highlight: { backgroundColor: colors.primary },
  label: { ...type.small, color: colors.textFaint, fontSize: 10 },
  highlightLabel: { color: colors.primary },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...type.small, color: colors.textFaint },
});
