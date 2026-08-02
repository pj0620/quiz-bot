import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from '../theme';

type Props = {
  name: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  accessibilityLabel: string;
};

export function HeaderIconButton({ name, onPress, accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // Nav-bar icons are small; widen the touch target to the 44pt minimum.
      hitSlop={12}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name={name} size={26} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  pressed: { opacity: 0.6 },
});
