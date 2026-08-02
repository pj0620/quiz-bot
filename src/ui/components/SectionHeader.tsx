import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type } from '../theme';

type Props = {
  title: string;
  /** Right-aligned: a count, a "See all" link, an add button. */
  accessory?: ReactNode;
};

/** The uppercase muted label, previously copy-pasted across screens. */
export function SectionHeader({ title, accessory }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    ...type.small,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
