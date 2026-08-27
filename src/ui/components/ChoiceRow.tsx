import {
  Ionicons } from '@expo/vector-icons';
import { Pressable,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, themedSheet, themedTokens, TOUCH_TARGET, type } from '../theme';

/**
 * The five visual states an answer option moves through.
 *
 * `selected` deliberately carries NO correctness signal — leaking the answer
 * before the user commits would defeat the whole exercise.
 */
export type ChoiceState = 'idle' | 'selected' | 'correct' | 'incorrect' | 'muted';

type Props = {
  label: string;
  state: ChoiceState;
  onPress?: () => void;
  disabled?: boolean;
  /** Marks the right answer after a wrong guess. */
  annotation?: string;
};

const ICONS = themedTokens<
  Record<ChoiceState, { name: keyof typeof Ionicons.glyphMap; color: string } | null>
>(() => ({
  idle: { name: 'ellipse-outline', color: colors.textFaint },
  selected: { name: 'radio-button-on', color: colors.primary },
  correct: { name: 'checkmark-circle', color: colors.success },
  incorrect: { name: 'close-circle', color: colors.danger },
  muted: { name: 'ellipse-outline', color: colors.textFaint },
}));

export function ChoiceRow({ label, state, onPress, disabled, annotation }: Props) {
  const icon = ICONS[state];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: state === 'selected', disabled }}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        styles.row,
        state === 'selected' && styles.selected,
        state === 'correct' && styles.correct,
        state === 'incorrect' && styles.incorrect,
        state === 'muted' && styles.muted,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon.name} size={22} color={icon.color} /> : null}
      <View style={styles.textWrap}>
        <Text style={[styles.label, state === 'muted' && styles.mutedText]}>{label}</Text>
        {annotation ? <Text style={styles.annotation}>{annotation}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = themedSheet(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // Tighter vertically than horizontally: four or five of these stack up, and
    // the whole set needs to be visible without scrolling past the question.
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  selected: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  correct: { backgroundColor: colors.successSurface, borderColor: colors.success },
  incorrect: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  // Non-chosen options after reveal recede rather than competing for attention.
  muted: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  textWrap: { flex: 1, gap: 2 },
  label: { ...type.body, color: colors.text },
  mutedText: { color: colors.textMuted },
  annotation: { ...type.small, color: colors.textMuted },
}));
