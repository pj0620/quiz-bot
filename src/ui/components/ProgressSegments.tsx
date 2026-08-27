import { View } from 'react-native';

import { colors, radius, themedSheet, themedTokens } from '../theme';
import type { Outcome } from '../../quiz/types';

/** One segment per question: unanswered, current, or coloured by outcome. */
export type SegmentState = Outcome | 'pending' | 'current' | 'flagged';

const SEGMENT_COLORS = themedTokens<Record<SegmentState, string>>(() => ({
  correct: colors.success,
  partial: colors.warning,
  incorrect: colors.danger,
  flagged: colors.textFaint,
  current: colors.primary,
  pending: colors.surfaceAlt,
}));

type Props = {
  segments: SegmentState[];
  height?: number;
};

/**
 * The session progress indicator.
 *
 * Chosen over a plain bar because it costs the same space but carries far more:
 * how far through you are AND how you've done so far, at a glance.
 */
export function ProgressSegments({ segments, height = 6 }: Props) {
  return (
    <View style={styles.row} accessibilityRole="progressbar">
      {segments.map((state, index) => (
        <View
          key={index}
          style={[
            styles.segment,
            {
              height,
              borderRadius: height / 2,
              backgroundColor: SEGMENT_COLORS[state],
            },
            state === 'current' && styles.current,
          ]}
        />
      ))}
    </View>
  );
}

const styles = themedSheet(() => ({
  row: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  segment: { flex: 1, borderRadius: radius.pill },
  // The current segment reads as "you are here" rather than an outcome.
  current: { opacity: 1 },
}));
