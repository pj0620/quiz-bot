import type { ReactNode } from 'react';
import {
  Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { colors, radius, spacing, themedSheet, themedTokens, type } from '../theme';

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

const TONES = themedTokens(() => ({
  info: { surface: colors.surfaceAlt, border: colors.border, fg: colors.text, icon: 'information-circle' },
  success: { surface: colors.successSurface, border: colors.success, fg: colors.success, icon: 'checkmark-circle' },
  warning: { surface: colors.warningSurface, border: colors.warning, fg: colors.warning, icon: 'alert-circle' },
  danger: { surface: colors.dangerSurface, border: colors.danger, fg: colors.danger, icon: 'close-circle' },
} as const));

type Props = {
  tone?: CalloutTone;
  title?: string;
  message: string;
  children?: ReactNode;
};

export function Callout({ tone = 'info', title, message, children }: Props) {
  const palette = TONES[tone];

  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.header}>
        <Ionicons name={palette.icon} size={18} color={palette.fg} />
        <View style={styles.textWrap}>
          {title ? <Text style={[styles.title, { color: palette.fg }]}>{title}</Text> : null}
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  container: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', gap: spacing.sm },
  textWrap: { flex: 1, gap: 2 },
  title: { ...type.smallStrong },
  message: { ...type.small, color: colors.text, lineHeight: 19 },
  actions: { gap: spacing.sm },
}));
