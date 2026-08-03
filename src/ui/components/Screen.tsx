import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { colors, spacing } from '../theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
};

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  padded = true,
}: Props) {
  if (!scroll) {
    return <View style={[styles.container, padded && styles.padded]}>{children}</View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[padded && styles.padded, styles.scrollContent]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          // Without an explicit tint the spinner renders near-black and is
          // effectively invisible against the dark background.
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Less padding above than beside: the navigation header already provides
  // separation at the top, so repeating it there just wastes a scroll.
  padded: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scrollContent: { paddingBottom: spacing.xl, gap: spacing.md },
});
