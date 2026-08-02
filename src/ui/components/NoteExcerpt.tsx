import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

type Props = {
  /** Plain prose, already stripped of markdown by the note parser. */
  text: string;
  /** The note this came from, e.g. "First Year of Fighting". */
  noteTitle?: string;
  /** The heading within that note, e.g. "Border States". */
  section?: string;
  maxChars?: number;
};

/**
 * A quoted passage from a note — the prose counterpart to `CodeBlock`.
 *
 * The differences from a code block are the whole point. Prose WRAPS rather
 * than scrolling horizontally, reads at body size in the body font, and is
 * attributed by note and heading rather than by file path and line numbers.
 * Showing someone their own revision notes in monospace with a repository path
 * above them makes them translate before they can recognise their own writing.
 */
export function NoteExcerpt({ text, noteTitle, section, maxChars = 600 }: Props) {
  const truncated = text.length > maxChars;
  const shown = truncated ? `${text.slice(0, maxChars).trimEnd()}…` : text;
  const caption = [noteTitle, section].filter(Boolean).join(' › ');

  return (
    <View style={styles.wrapper}>
      {caption ? (
        <View style={styles.captionRow}>
          <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
          <Text style={styles.caption} numberOfLines={2}>
            {caption}
          </Text>
        </View>
      ) : null}
      <View style={styles.quote}>
        <Text style={styles.text} selectable>
          {shown || '(no readable text in this section)'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  caption: { ...type.smallStrong, color: colors.textMuted, flex: 1 },
  quote: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    // A quote rule, so an excerpt reads as someone else's words rather than
    // as more of the app's own copy.
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  text: { ...type.body, color: colors.text, lineHeight: 24 },
});
