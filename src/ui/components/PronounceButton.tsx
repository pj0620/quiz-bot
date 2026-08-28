import { Ionicons } from '@expo/vector-icons';
import { Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { usePronunciation } from '../../quiz/vocab/usePronunciation';
import { colors, radius, themedSheet, TOUCH_TARGET } from '../theme';

type Props = {
  /** The word to say — the display form, not the slug. */
  word: string;
  /** Diameter. The default suits a title; pass smaller beside body text. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * The speaker button beside a vocabulary word, after the one on Google's
 * definition panel: a tinted disc with a speaker glyph that says the word out
 * loud. It plays the same recordings that panel plays where they exist, and
 * the device's voice where they don't — see `usePronunciation` for the chain.
 *
 * The disc inverts to a solid fill while the sound is live, which is the
 * only confirmation a ~1 second clip needs. The corner comes from
 * `radius.pill`, so the "disc" is a circle in the modern themes and squares
 * off in the period ones, the way every other pill in the app does.
 */
export function PronounceButton({ word, size = 36, style }: Props) {
  const { pronounce, active } = usePronunciation(word);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hear "${word}"`}
      accessibilityHint="Plays the pronunciation out loud"
      // Small discs still get the full 44pt target, as HeaderIconButton does.
      hitSlop={Math.max(0, Math.ceil((TOUCH_TARGET - size) / 2))}
      onPress={() => void pronounce()}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size },
        active && styles.active,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Ionicons
        name="volume-high"
        size={Math.round(size * 0.55)}
        color={active ? colors.primaryText : colors.primary}
      />
    </Pressable>
  );
}

const styles = themedSheet(() => ({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySurface,
  },
  active: { backgroundColor: colors.primary },
  pressed: { opacity: 0.7 },
}));
