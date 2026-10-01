import { type ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { colors, spacing, themedSheet } from '../theme';
import { TextField } from './TextField';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  items: string[];
  onChange: (items: string[]) => void;
  /**
   * The text in the "add another" field, held by the parent. Controlled so a
   * Save pressed with something typed but not yet added can keep it — tapping
   * a button does not blur the field first, and losing a typed bullet silently
   * is the worst outcome on offer.
   */
  draft: string;
  onDraftChange: (draft: string) => void;
  placeholder: string;
  max: number;
  maxChars: number;
  /** The bullet beside each row — a tick for "ask about", a cross for "leave alone". */
  icon: IoniconName;
  iconColor: string;
};

/** The list with its pending entry folded in — what a Save should store. */
export function withDraft(items: readonly string[], draft: string, max: number, maxChars: number): string[] {
  const text = draft.trim().slice(0, maxChars);
  return text && items.length < max ? [...items, text] : [...items];
}

/**
 * A short list of phrases, edited in place: every row is its own field, a
 * cross removes it, and the last field adds a new one on return.
 *
 * In place rather than add-and-delete only, because the usual edit is a word
 * in an existing bullet — "the experiments" to "the experiments' numbers" —
 * and deleting a bullet to retype it is the wrong amount of work for that.
 */
export function ListEditor({
  items,
  onChange,
  draft,
  onDraftChange,
  placeholder,
  max,
  maxChars,
  icon,
  iconColor,
}: Props) {
  const add = () => {
    const next = withDraft(items, draft, max, maxChars);
    if (next.length !== items.length) onChange(next);
    onDraftChange('');
  };

  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <View key={index} style={styles.row}>
          <Ionicons name={icon} size={16} color={iconColor} />
          <View style={styles.field}>
            <TextField
              value={item}
              onChangeText={(text) => onChange(items.map((entry, at) => (at === index ? text : entry)))}
              maxLength={maxChars}
              autoCapitalize="sentences"
              autoCorrect
              size="compact"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove “${item}”`}
            onPress={() => onChange(items.filter((_, at) => at !== index))}
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </Pressable>
        </View>
      ))}
      {items.length < max ? (
        <View style={styles.row}>
          <Ionicons name="add" size={16} color={colors.textFaint} />
          <View style={styles.field}>
            <TextField
              value={draft}
              onChangeText={onDraftChange}
              onSubmitEditing={add}
              placeholder={placeholder}
              maxLength={maxChars}
              autoCapitalize="sentences"
              autoCorrect
              returnKeyType="done"
              size="compact"
            />
          </View>
          <View style={styles.placeholderIcon} />
        </View>
      ) : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: { flex: 1 },
  placeholderIcon: { width: 20 },
}));
