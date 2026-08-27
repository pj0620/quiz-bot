import { Text, View } from 'react-native';

import { colors, radius, spacing, themedSheet, type } from '../theme';

export type Segment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  segments: Segment[];
  height?: number;
  /** Hides the legend when the caller labels the parts itself. */
  showLegend?: boolean;
};

/**
 * A single stacked bar showing how a whole divides up — the mastery mix.
 *
 * Chosen over a pie for two reasons: comparing angles is harder than comparing
 * lengths, and a bar keeps working at the width of a phone card without a
 * legend fighting it for space.
 */
/** Total percentage width of every segment before `index`. */
function percentBefore(visible: readonly Segment[], index: number, total: number): number {
  let sum = 0;
  for (let i = 0; i < index; i += 1) sum += (visible[i].value / total) * 100;
  return sum;
}

export function SegmentedBar({ segments, height = 10, showLegend = true }: Props) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        {total === 0
          ? null
          : visible.map((segment, index) => (
              <View
                key={segment.label}
                /*
                  Percentage widths, NOT `flex: segment.value`.

                  A numeric flex here crashed the app natively — a segfault on
                  the JS thread inside Hermes, with no JS error to catch, every
                  time this bar rendered with real counts. Percentages lay the
                  bar out identically and are the reason the Stats tab loads at
                  all, so this is load-bearing rather than stylistic.

                  The last segment absorbs the rounding remainder instead of
                  computing its own share, which is what stops a sub-pixel
                  sliver of empty track showing at the end of a full bar.
                */
                style={{
                  width:
                    index === visible.length - 1
                      ? `${100 - percentBefore(visible, index, total)}%`
                      : `${(segment.value / total) * 100}%`,
                  backgroundColor: segment.color,
                }}
              />
            ))}
      </View>

      {showLegend ? (
        <View style={styles.legend}>
          {segments.map((segment) => (
            <View key={segment.label} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: segment.color }]} />
              <Text style={styles.legendLabel}>
                {segment.label} {segment.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  wrapper: { gap: spacing.sm },
  track: { flexDirection: 'row', overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...type.small, color: colors.textMuted },
}));
