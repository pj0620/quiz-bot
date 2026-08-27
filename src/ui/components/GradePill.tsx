import { Text, View } from 'react-native';

import { colors, radius, themedSheet, themedTokens, type } from '../theme';
import type { LetterGrade } from '../../quiz/stats';

/**
 * Grade colours, deliberately three bands rather than five.
 *
 * A pass/fail split (red) and a "doing well" split (green) are the two things
 * worth acting on; C and B share the middle because the difference between them
 * changes nothing about what you would do next. Shared with `ScoreDots` so a
 * grade means the same colour wherever it appears.
 */
export const GRADE_COLORS = themedTokens<Record<LetterGrade, string>>(() => ({
  A: colors.success,
  B: colors.primary,
  C: colors.primary,
  D: colors.danger,
  F: colors.danger,
}));

const GRADE_SURFACES = themedTokens<Record<LetterGrade, string>>(() => ({
  A: colors.successSurface,
  B: colors.primarySurface,
  C: colors.primarySurface,
  D: colors.dangerSurface,
  F: colors.dangerSurface,
}));

type Props = {
  /** Null renders the "not attempted yet" state rather than an F. */
  grade: LetterGrade | null;
  /** 0..1, shown beside the letter when there is room. */
  score?: number | null;
  size?: 'sm' | 'md';
};

/**
 * A letter grade as a tinted pill.
 *
 * Tinted rather than solid: these sit in dense lists next to progress bars and
 * mastery dots, and five saturated blocks down the right edge of a screen would
 * shout louder than the content they describe.
 */
export function GradePill({ grade, score, size = 'md' }: Props) {
  if (!grade) {
    return (
      <View style={[styles.pill, styles.empty, size === 'sm' && styles.pillSm]}>
        <Text style={[styles.letter, styles.emptyText, size === 'sm' && styles.letterSm]}>—</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.pill,
        size === 'sm' && styles.pillSm,
        { backgroundColor: GRADE_SURFACES[grade] },
      ]}
    >
      <Text style={[styles.letter, size === 'sm' && styles.letterSm, { color: GRADE_COLORS[grade] }]}>
        {grade}
      </Text>
      {score !== null && score !== undefined && size === 'md' ? (
        <Text style={[styles.score, { color: GRADE_COLORS[grade] }]}>{Math.round(score * 100)}</Text>
      ) : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    minWidth: 34,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  pillSm: { minWidth: 24, paddingHorizontal: 5, paddingVertical: 1 },
  letter: { ...type.smallStrong, fontSize: 14, fontWeight: '800' },
  letterSm: { fontSize: 11 },
  score: { ...type.micro, fontSize: 10, opacity: 0.85 },
  empty: { backgroundColor: colors.surfaceRaised },
  emptyText: { color: colors.textFaint },
}));
