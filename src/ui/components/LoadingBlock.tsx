import { ActivityIndicator, Text, View } from 'react-native';

import { colors, spacing, themedSheet, type } from '../theme';

type Props = {
  message?: string;
  /** 'inline' sits within content; 'page' centres in the available space. */
  size?: 'inline' | 'page';
};

/** The spinner-plus-caption block, previously duplicated across four screens. */
export function LoadingBlock({ message, size = 'page' }: Props) {
  return (
    <View style={[styles.container, size === 'inline' && styles.inline]}>
      <ActivityIndicator size="small" color={colors.primary} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  inline: { flexDirection: 'row', paddingVertical: spacing.md },
  message: { ...type.small, color: colors.textMuted, textAlign: 'center' },
}));
