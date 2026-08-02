import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type } from '../theme';

export type Stat = {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
};

const TONE_COLORS = {
  default: colors.text,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  muted: colors.textMuted,
} as const;

type Props = {
  stats: Stat[];
};

/** Evenly-spaced metric row: Correct / Partial / Missed, or bank counts. */
export function StatRow({ stats }: Props) {
  return (
    <View style={styles.row}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.item}>
          <Text style={[styles.value, { color: TONE_COLORS[stat.tone ?? 'default'] }]}>{stat.value}</Text>
          <Text style={styles.label}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  value: { ...type.heading },
  label: { ...type.small, color: colors.textMuted, textAlign: 'center' },
});
