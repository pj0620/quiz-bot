import type { ComponentProps, ReactNode } from 'react';
import {
  Ionicons } from '@expo/vector-icons';
import { Text, View, type ViewStyle } from 'react-native';

import { accents, colors, elevation, radius, spacing, themedSheet, type, type AccentName } from '../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  children: ReactNode;
  title?: string;
  /** Right-aligned content in the title row: a count, a badge, an action. */
  titleAccessory?: ReactNode;
  /**
   * Tints the title icon and its chip. Colour-codes a screen's sections so
   * they're distinguishable at a glance while scrolling.
   */
  accent?: AccentName;
  /** Sits in a tinted square beside the title. Needs `accent` to be worth it. */
  icon?: IoniconName;
  footer?: ReactNode;
  /** 'inset' recedes into the page; 'raised' lifts off it. */
  tone?: 'default' | 'inset' | 'raised';
  style?: ViewStyle;
};

/**
 * The card container.
 *
 * Depth comes from the FILL, with the border only reinforcing it. The previous
 * version drew a hairline around the page background, so every card read as an
 * outline on flat paper and the whole app looked like a wireframe.
 */
export function Card({
  children,
  title,
  titleAccessory,
  accent,
  icon,
  footer,
  tone = 'default',
  style,
}: Props) {
  const tint = accent ? accents[accent] : null;

  return (
    <View
      style={[
        styles.card,
        tone === 'inset' && styles.inset,
        tone === 'raised' && styles.raised,
        style,
      ]}
    >
      {title || titleAccessory ? (
        <View style={styles.header}>
          {icon ? (
            <View style={[styles.iconChip, tint ? { backgroundColor: tint.surface } : null]}>
              <Ionicons name={icon} size={15} color={tint ? tint.fg : colors.textMuted} />
            </View>
          ) : null}
          {title ? <Text style={styles.title}>{title}</Text> : <View style={styles.spacer} />}
          {titleAccessory}
        </View>
      ) : null}
      {children}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    ...(elevation.card as object),
  },
  // Recedes rather than lifts: for quoted material inside another surface.
  inset: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  raised: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  title: { ...type.bodyStrong, color: colors.text, flex: 1 },
  spacer: { flex: 1 },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
}));
