import { Text, View } from 'react-native';

import { colors, spacing, themedSheet, type } from '../theme';
import { GRADE_COLORS } from './GradePill';
import type { LetterGrade } from '../../quiz/stats';

export type ScoreDay = {
  /** Under the dot — a weekday initial. */
  label: string;
  /** 0..1, or null when the day was skipped. */
  score: number | null;
  grade: LetterGrade | null;
  /** Emphasised label, e.g. today. */
  highlight?: boolean;
};

type Props = {
  days: ScoreDay[];
};

/**
 * A week of daily scores, one dot per day.
 *
 * Dots rather than bars because the value being shown is a percentage, not a
 * quantity: every day that was studied is the same "size", and only the colour
 * and the number differ. A skipped day is a small grey dot rather than an empty
 * slot, so the rhythm of a week — and the gaps in it — stays readable.
 */
export function ScoreDots({ days }: Props) {
  return (
    <View style={styles.row}>
      {days.map((day, index) => (
        <View key={index} style={styles.column}>
          <View style={styles.slot}>
            {day.score === null || day.grade === null ? (
              <View style={styles.skipped} />
            ) : (
              <View style={[styles.dot, { backgroundColor: GRADE_COLORS[day.grade] }]}>
                {/*
                  Dark text on every fill. All three grade colours are light
                  enough that white would drop under AA on them, and keeping one
                  text colour means the number reads identically across the row.
                */}
                <Text style={styles.score}>{Math.round(day.score * 100)}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.label, day.highlight && styles.today]} numberOfLines={1}>
            {day.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const DOT = 34;

const styles = themedSheet(() => ({
  row: { flexDirection: 'row', gap: 3 },
  column: { flex: 1, alignItems: 'center', gap: spacing.xs },
  // Fixed so the small skipped dot centres against the full-size ones rather
  // than shifting the row's baseline.
  slot: { height: DOT, alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 12, fontWeight: '700', color: colors.primaryText },
  skipped: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt },
  label: { ...type.small, color: colors.textFaint, fontSize: 10 },
  today: { color: colors.primary },
}));
