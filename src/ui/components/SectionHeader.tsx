import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { accents, colors, spacing, type, type AccentName } from '../theme';

type Props = {
  title: string;
  /** Right-aligned: a count, a "See all" link, an add button. */
  accessory?: ReactNode;
  /** Colour of the leading rule, for colour-coding a screen's sections. */
  accent?: AccentName;
};

/**
 * The uppercase section label.
 *
 * Now carries a short accent rule before the text. A row of identical grey
 * capitals was the weakest hierarchy signal in the app — at a glance nothing
 * separated a section start from the dense content above it.
 */
export function SectionHeader({ title, accessory, accent = 'primary' }: Props) {
  return (
    <View style={styles.row}>
      <View style={[styles.rule, { backgroundColor: accents[accent].fg }]} />
      <Text style={styles.title}>{title}</Text>
      <View style={styles.spacer} />
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  rule: { width: 3, height: 12, borderRadius: 2 },
  title: {
    ...type.overline,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  spacer: { flex: 1 },
});
