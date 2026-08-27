import { Text, View } from 'react-native';

import { colors, radius, spacing, themedSheet, themedTokens, type } from '../theme';

export type Stat = {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
};

const TONE_COLORS = themedTokens(() => ({
  default: colors.text,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  muted: colors.textMuted,
} as const));

type Props = {
  stats: Stat[];
};

/**
 * Evenly-spaced metric row: Correct / Partial / Missed, or bank counts.
 *
 * Sits on its own panel with hairline dividers between the figures. Floating
 * bare on the page they read as three unrelated numbers; grouped, they read as
 * one summary, which is what they are.
 */
export function StatRow({ stats }: Props) {
  return (
    <View style={styles.row}>
      {stats.map((stat, index) => (
        <View key={stat.label} style={[styles.item, index > 0 && styles.divided]}>
          <Text style={[styles.value, { color: TONE_COLORS[stat.tone ?? 'default'] }]}>{stat.value}</Text>
          <Text style={styles.label} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = themedSheet(() => ({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  item: { flex: 1, alignItems: 'center', gap: 1 },
  divided: { borderLeftWidth: 1, borderLeftColor: colors.border },
  value: { ...type.heading, fontSize: 22 },
  label: { ...type.small, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
}));
