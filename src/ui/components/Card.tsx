import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

type Props = {
  children: ReactNode;
  title?: string;
  /** Right-aligned content in the title row: a count, a badge, an action. */
  titleAccessory?: ReactNode;
  footer?: ReactNode;
  /** 'inset' sits on the page background; 'raised' lifts off it. */
  tone?: 'default' | 'inset' | 'raised';
  style?: ViewStyle;
};

/**
 * The card container, extracted from three inline copies in
 * `app/sources/[id].tsx` plus `UserCodeCard`'s outer view.
 */
export function Card({ children, title, titleAccessory, footer, tone = 'default', style }: Props) {
  return (
    <View style={[styles.card, tone === 'inset' && styles.inset, tone === 'raised' && styles.raised, style]}>
      {title || titleAccessory ? (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : <View />}
          {titleAccessory}
        </View>
      ) : null}
      {children}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  inset: { backgroundColor: colors.surface },
  raised: { backgroundColor: colors.surface, borderColor: colors.surfaceAlt },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...type.bodyStrong, color: colors.text, flex: 1 },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
});
