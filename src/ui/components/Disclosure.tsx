import {
  useCallback,
  useState,
  type ComponentProps,
  type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable,
  Text,
  View,
} from 'react-native';

import { colors, spacing, themedSheet, TOUCH_TARGET, type } from '../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  title: string;
  /**
   * The current answer, shown on the closed row.
   *
   * The point of the whole component: a settings row that has to be opened
   * before it will say what it is set to has cost the reader a tap and told
   * them nothing, so collapsing is only a saving when the summary is here.
   */
  value?: string;
  /** Replaces `value` when the summary is better shown than written — a badge. */
  accessory?: ReactNode;
  icon?: IoniconName;
  /** Hairline above the header, for the second and later rows in a group. */
  divider?: boolean;
  /** Controlled mode: pass both to run an accordion where one row opens at a time. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * A settings row that hides its controls until asked for.
 *
 * Written for the settings screen, where the material is mostly things you set
 * once — a key, a model, a paragraph of preferences — and then scroll past
 * forever. Laid out flat, that screen was several phone-heights of controls
 * nobody was touching, which pushed the parts that ARE touched off the bottom.
 *
 * Deliberately not animated. A height transition on a row containing a text
 * field means measuring content that can reflow as the keyboard appears, and
 * the failure mode there is a clipped field rather than a missing flourish.
 */
export function Disclosure({
  title,
  value,
  accessory,
  icon,
  divider = false,
  open,
  onToggle,
  defaultOpen = false,
  children,
}: Props) {
  // Uncontrolled unless the caller supplies `open`, so a lone row doesn't force
  // its parent to hold state it has no other use for.
  const [internal, setInternal] = useState(defaultOpen);
  const isOpen = open ?? internal;

  const toggle = useCallback(() => {
    const next = !isOpen;
    setInternal(next);
    onToggle?.(next);
  }, [isOpen, onToggle]);

  return (
    <View style={divider ? styles.divided : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={toggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        {icon ? <Ionicons name={icon} size={16} color={colors.textMuted} /> : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {accessory ??
          (value ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : null)}
        <Ionicons
          name={isOpen ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={colors.textFaint}
        />
      </Pressable>
      {isOpen ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    // Negative inset so the tap target spans the card's padding while the text
    // still lines up with everything else in it.
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.surfaceActive },
  title: { ...type.bodyStrong, fontSize: 15, color: colors.text },
  // Shrinks before the title does: a long model name should truncate, not push
  // the label it belongs to off the row.
  value: { ...type.small, color: colors.textMuted, flex: 1, textAlign: 'right' },
  body: { gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.md },
}));
