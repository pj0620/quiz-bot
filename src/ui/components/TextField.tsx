import {
  forwardRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, themedSheet, type } from '../theme';

type Props = Omit<TextInputProps, 'style'> & {
  label?: string;
  /** Renders the field in an error state with the message beneath. */
  error?: string;
  multiline?: boolean;
  /** Visual density: 'compact' for inline blanks, 'default' otherwise. */
  size?: 'default' | 'compact';
};

/**
 * Themed text input, extracted from the raw TextInput in the repo picker.
 *
 * Sets `keyboardAppearance="dark"` by default — the system keyboard doesn't
 * follow the app's theme automatically, and a light keyboard under a dark UI
 * is jarring.
 */
export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, multiline, size = 'default', ...props },
  ref,
) {
  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textFaint}
        keyboardAppearance="dark"
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        style={[
          styles.input,
          size === 'compact' && styles.compact,
          multiline && styles.multiline,
          !!error && styles.errored,
        ]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

const styles = themedSheet(() => ({
  wrapper: { gap: spacing.xs },
  label: { ...type.smallStrong, color: colors.textMuted },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  compact: { minHeight: 36, paddingHorizontal: spacing.sm, ...type.small },
  multiline: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  errored: { borderColor: colors.danger },
  error: { ...type.small, color: colors.danger },
}));
