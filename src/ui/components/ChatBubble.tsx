import { memo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import type { PlanMessage } from '../../quiz/builder/types';
import { colors, radius, spacing, themedSheet, type } from '../theme';

type Props = {
  message: PlanMessage;
  /** Shown on an assistant message that changed the plan. */
  onShowPlan?: () => void;
};

/** A digest is long; this much says what it is about. */
const FEEDBACK_PREVIEW_LINES = 5;

/**
 * One message in a plan's conversation.
 *
 * Three voices, deliberately unalike: the reader on the right, the planner on
 * the left, and the app — "You accepted plan v2" — as a quiet centred line,
 * so it reads as a marker in the history rather than as anyone talking.
 */
function ChatBubbleInner({ message, onShowPlan }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (message.role === 'event') {
    return (
      <View style={styles.eventRow}>
        <View style={styles.eventRule} />
        <Text style={styles.event}>{message.text}</Text>
        <View style={styles.eventRule} />
      </View>
    );
  }

  if (message.kind === 'feedback') {
    return (
      <View style={[styles.row, styles.mine]}>
        <View style={[styles.bubble, styles.mineBubble, styles.feedback]}>
          <View style={styles.feedbackHeader}>
            <Ionicons name="chatbox-ellipses-outline" size={15} color={colors.primary} />
            <Text style={styles.feedbackTitle}>Your review</Text>
          </View>
          <Text style={styles.text} numberOfLines={expanded ? undefined : FEEDBACK_PREVIEW_LINES}>
            {message.text}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} hitSlop={8}>
            <Text style={styles.link}>{expanded ? 'Show less' : 'Show all'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const mine = message.role === 'user';
  return (
    <View style={[styles.row, mine ? styles.mine : styles.theirs]}>
      <View style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
        <Text style={styles.text} selectable>
          {message.text}
        </Text>
        {!mine && message.planVersion !== undefined ? (
          <Pressable
            accessibilityRole="button"
            onPress={onShowPlan}
            disabled={!onShowPlan}
            style={({ pressed }) => [styles.planChip, pressed && styles.pressed]}
          >
            <Ionicons name="document-text-outline" size={13} color={colors.primary} />
            <Text style={styles.planChipText}>Updated the plan · v{message.planVersion}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const ChatBubble = memo(ChatBubbleInner);

/** The planner's "typing" row while a turn is in flight. */
export function ThinkingBubble({ label = 'Thinking about your plan…' }: { label?: string }) {
  return (
    <View style={[styles.row, styles.theirs]}>
      <View style={[styles.bubble, styles.theirBubble, styles.thinking]}>
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
        <Text style={styles.thinkingText}>{label}</Text>
      </View>
    </View>
  );
}

const styles = themedSheet(() => ({
  row: { flexDirection: 'row' },
  mine: { justifyContent: 'flex-end' },
  theirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
  },
  mineBubble: { backgroundColor: colors.primarySurface, borderColor: colors.primarySurface },
  theirBubble: { backgroundColor: colors.surface, borderColor: colors.border },
  text: { ...type.body, fontSize: 15, color: colors.text, lineHeight: 21 },
  feedback: { maxWidth: '92%' },
  feedbackHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  feedbackTitle: { ...type.smallStrong, color: colors.primary },
  link: { ...type.smallStrong, color: colors.primary },
  planChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySurface,
  },
  planChipText: { ...type.micro, color: colors.primary },
  pressed: { opacity: 0.7 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  eventRule: { flex: 1, height: 1, backgroundColor: colors.border },
  event: { ...type.micro, color: colors.textFaint, textAlign: 'center', maxWidth: '75%' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thinkingText: { ...type.small, color: colors.textMuted },
}));
