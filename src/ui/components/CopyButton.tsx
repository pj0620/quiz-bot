import {
  useCallback,
  useEffect,
  useRef,
  useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Pressable,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { selectTick } from '../haptics';
import { colors, radius, spacing, themedSheet, type } from '../theme';

type Props = {
  label: string;
  /**
   * What to put on the clipboard. A function when the text is expensive to
   * build or depends on state at press time — it is called on the tap, not on
   * every render.
   */
  text: string | (() => string);
  accessibilityLabel?: string;
  copiedLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Copy-to-clipboard, with the confirmation built in.
 *
 * The confirmation is the whole component: a copy button that doesn't visibly
 * change leaves the reader tapping it again to be sure, and a toast for
 * something this small is heavier than the action itself.
 */
export function CopyButton({ label, text, accessibilityLabel, copiedLabel = 'Copied', style }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleared on unmount: leaving the session mid-confirmation would otherwise
  // set state on a component that has gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(typeof text === 'function' ? text() : text);
    void selectTick();
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => void copy()}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}
    >
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={13}
        color={copied ? colors.success : colors.textMuted}
      />
      <Text style={[styles.label, copied && styles.copiedLabel]}>{copied ? copiedLabel : label}</Text>
    </Pressable>
  );
}

const styles = themedSheet(() => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  label: { ...type.micro, color: colors.textMuted },
  copiedLabel: { color: colors.success },
  pressed: { opacity: 0.6 },
}));
