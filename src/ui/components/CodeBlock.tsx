import { ScrollView, Text, View } from 'react-native';

import { colors, radius, spacing, themedSheet, type } from '../theme';

type Props = {
  code: string;
  /** Truncates very long content; the full text stays selectable up to this. */
  maxChars?: number;
  maxHeight?: number;
  /** Shown above the code — usually a file path. */
  caption?: string;
};

/**
 * Monospaced code, extracted from the inline block in `app/sources/[id].tsx`.
 *
 * Horizontally scrollable rather than wrapped: wrapping code destroys its
 * structure, and structure is most of what a code question is testing.
 */
export function CodeBlock({ code, maxChars = 4000, maxHeight = 320, caption }: Props) {
  const truncated = code.length > maxChars;
  const shown = truncated ? code.slice(0, maxChars) : code;

  return (
    <View style={styles.wrapper}>
      {caption ? <Text style={styles.caption} numberOfLines={1} ellipsizeMode="middle">{caption}</Text> : null}
      <ScrollView
        horizontal
        style={[styles.box, { maxHeight }]}
        contentContainerStyle={styles.content}
        showsHorizontalScrollIndicator
      >
        <Text style={styles.code} selectable>
          {shown || '(empty)'}
          {truncated ? '\n\n… truncated' : ''}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = themedSheet(() => ({
  wrapper: { gap: spacing.xs },
  caption: { ...type.small, color: colors.textMuted },
  box: { backgroundColor: colors.code, borderRadius: radius.sm },
  content: { padding: spacing.md },
  code: { ...type.mono, color: colors.codeText, lineHeight: 18 },
}));
