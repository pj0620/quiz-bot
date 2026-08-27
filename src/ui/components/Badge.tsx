import { Text, View } from 'react-native';

import { colors, radius, spacing, themedSheet, themedTokens, type } from '../theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const TONES = themedTokens<Record<BadgeTone, { bg: string; fg: string }>>(() => ({
  neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
  primary: { bg: colors.surfaceAlt, fg: colors.primary },
  success: { bg: colors.successSurface, fg: colors.success },
  warning: { bg: colors.warningSurface, fg: colors.warning },
  danger: { bg: colors.dangerSurface, fg: colors.danger },
}));

type Props = {
  label: string;
  tone?: BadgeTone;
};

/** Small status pill, extracted from RepoRow's inline "Added" badge. */
export function Badge({ label, tone = 'neutral' }: Props) {
  const palette = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = themedSheet(() => ({
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  label: { ...type.small, fontWeight: '600' },
}));
