import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type } from '../theme';
import { MASTERY_LABELS } from '../../quiz/srs/mastery';
import type { MasteryLevel } from '../../quiz/types';

export const MASTERY_COLORS: Record<MasteryLevel, string> = {
  new: colors.textFaint,
  learning: colors.primary,
  shaky: colors.danger,
  familiar: colors.warning,
  solid: colors.success,
};

type Props = {
  level: MasteryLevel;
  size?: number;
  showLabel?: boolean;
};

export function MasteryDot({ level, size = 10, showLabel = false }: Props) {
  return (
    <View style={styles.row}>
      <View
        accessibilityLabel={`Mastery: ${MASTERY_LABELS[level]}`}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: MASTERY_COLORS[level],
        }}
      />
      {showLabel ? <Text style={styles.label}>{MASTERY_LABELS[level]}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { ...type.small, color: colors.textMuted },
});
