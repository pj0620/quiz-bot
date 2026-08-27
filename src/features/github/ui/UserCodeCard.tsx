import {
  Ionicons } from '@expo/vector-icons';
import { Pressable,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, themedSheet, type } from '../../../ui/theme';

type Props = {
  code: string;
  copied: boolean;
  onCopy: () => void;
};

/**
 * The 8-character code (e.g. WDJB-MJHT) the user types on github.com/login/device.
 *
 * Note there is no way to pre-fill it: GitHub does not return the RFC 8628
 * `verification_uri_complete` field, so copy-to-clipboard plus a plain link is
 * genuinely the best available UX here.
 */
export function UserCodeCard({ code, copied, onCopy }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy code ${code.split('').join(' ')}`}
      onPress={onCopy}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.code} selectable>
        {code}
      </Text>
      <View style={styles.hint}>
        <Ionicons
          name={copied ? 'checkmark-circle' : 'copy-outline'}
          size={16}
          color={copied ? colors.success : colors.textMuted}
        />
        <Text style={[styles.hintText, copied && styles.copiedText]}>
          {copied ? 'Copied' : 'Tap to copy'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = themedSheet(() => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: { opacity: 0.75 },
  code: {
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: 4,
    color: colors.text,
    // Tabular figures keep the code from shifting width as digits change.
    fontVariant: ['tabular-nums'],
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hintText: { ...type.small, color: colors.textMuted },
  copiedText: { color: colors.success },
}));
