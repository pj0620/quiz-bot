import type { ComponentProps, ReactNode } from 'react';
import {
  Ionicons } from '@expo/vector-icons';
import { Pressable,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, themedSheet, TOUCH_TARGET, type } from '../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  title: string;
  subtitle?: string;
  icon?: IoniconName;
  /**
   * Overrides the leading icon's tint.
   *
   * Exists for the selection checkbox in the question bank: an unticked box has
   * to read as available rather than as an action, and the default accent makes
   * every row look like it is already doing something.
   */
  iconColor?: string;
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
  iconColor,
  onPress,
  disabled = false,
  accessory,
  showChevron = false,
}: Props) {
  const content = (
    <>
      {icon ? (
        <View style={styles.iconWrap}>
          <Ionicons
            name={icon}
            size={16}
            color={disabled ? colors.textFaint : (iconColor ?? colors.primary)}
          />
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

const styles = themedSheet(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    // The tap-target floor rather than a designed height: with a title and a
    // subtitle the content already exceeds it, so this only matters for rows
    // that carry a title alone.
    minHeight: TOUCH_TARGET,
  },
  /*
    A fill change on press, not a fade.

    Dropping opacity on a dark surface mostly makes a row look disabled; moving
    it one step nearer the eye reads as "you touched this".
  */
  pressed: { backgroundColor: colors.surfaceActive, borderColor: colors.borderStrong },
  // A tinted square rather than a bare glyph, so rows with and without icons
  // still line their text up.
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  textWrap: { flex: 1, gap: 1 },
  title: { ...type.bodyStrong, fontSize: 15, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  dimmed: { color: colors.textFaint },
}));
