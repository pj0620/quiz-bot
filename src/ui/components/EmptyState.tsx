import type { ComponentProps } from 'react';
import {
  Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { colors, spacing, themedSheet, type } from '../theme';
import { Button } from './Button';

type Props = {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  actionTitle?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, body, actionTitle, onAction }: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={44} color={colors.textFaint} />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: { ...type.heading, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  action: { marginTop: spacing.sm, alignSelf: 'center', width: '100%', maxWidth: 320 },
}));
