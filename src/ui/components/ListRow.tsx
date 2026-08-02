import type { ComponentProps, ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  title: string;
  subtitle?: string;
  icon?: IoniconName;
  onPress?: () => void;
  disabled?: boolean;
  /** Rendered on the right: a badge, a checkmark, a health dot. */
  accessory?: ReactNode;
  showChevron?: boolean;
};

export function ListRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
  accessory,
  showChevron = false,
}: Props) {
  const content = (
    <>
      {icon ? (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={20} color={disabled ? colors.textFaint : colors.text} />
        </View>
      ) : null}
      <View style={styles.textWrap}>
        <Text style={[styles.title, disabled && styles.dimmed]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, disabled && styles.dimmed]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 60,
  },
  pressed: { opacity: 0.7 },
  iconWrap: { width: 24, alignItems: 'center' },
  textWrap: { flex: 1, gap: 2 },
  title: { ...type.bodyStrong, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  dimmed: { color: colors.textFaint },
});
