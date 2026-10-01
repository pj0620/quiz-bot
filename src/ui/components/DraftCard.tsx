import { memo, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { FEEDBACK_TAGS, emptyReview } from '../../quiz/builder/feedback';
import type { DraftReview, DraftVerdict } from '../../quiz/builder/types';
import { getAnswerView, getQuestionLogic } from '../../quiz/questionTypes';
import type { Grade, Question } from '../../quiz/types';
import { colors, radius, spacing, themedSheet, themedTokens, type } from '../theme';
import { Badge } from './Badge';
import { Chip, ChipGroup } from './Chip';
import { TextField } from './TextField';

type Props = {
  question: Question;
  /** 1-based, so the reader can say "number four" to themselves. */
  index: number;
  review: DraftReview | undefined;
  /** Absent makes the card read-only — a kept batch looked at later. */
  onReview?: (questionId: string, review: DraftReview) => void;
  onEdit?: (questionId: string) => void;
  /** This draft is being rewritten right now. */
  fixing?: boolean;
};

const VERDICTS: { verdict: DraftVerdict; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { verdict: 'keep', label: 'Keep', icon: 'checkmark-circle-outline' },
  { verdict: 'fix', label: 'Needs work', icon: 'construct-outline' },
  { verdict: 'drop', label: 'Drop', icon: 'trash-outline' },
];

const VERDICT_COLORS = themedTokens<Record<DraftVerdict, { fg: string; surface: string }>>(() => ({
  keep: { fg: colors.success, surface: colors.successSurface },
  fix: { fg: colors.warning, surface: colors.warningSurface },
  drop: { fg: colors.danger, surface: colors.dangerSurface },
}));

/**
 * One drafted question, shown answered, with the three things a reader can
 * decide about it.
 *
 * The answer is REVEALED, using the player's own view — the reader is judging
 * the question, and a question cannot be judged without its answer. The
 * verdicts are one tap each, and tapping the chosen one again clears it,
 * because "I changed my mind, I haven't decided" is a real state.
 *
 * Reasons appear only under "Needs work", where they are the point. Most
 * questions in a decent batch get no tap at all, and are kept.
 */
function DraftCardInner({ question, index, review, onReview, onEdit, fixing = false }: Props) {
  const AnswerView = getAnswerView(question.format);
  const revealed: Grade = useMemo(() => ({ status: 'graded', outcome: 'correct', score: 1 }), []);
  const current = review ?? emptyReview();
  const verdict = current.verdict;
  const dropped = verdict === 'drop';

  const update = (patch: Partial<DraftReview>) => onReview?.(question.id, { ...current, ...patch });

  const choose = (next: DraftVerdict) => {
    // A second tap on the chosen verdict clears it back to "not looked at".
    if (verdict === next) update({ verdict: undefined });
    else update({ verdict: next, error: undefined });
  };

  const toggleTag = (tag: DraftReview['tags'][number]) => {
    const tags = current.tags.includes(tag) ? current.tags.filter((entry) => entry !== tag) : [...current.tags, tag];
    // Giving a reason is saying it needs work; no extra tap required.
    update({ tags, verdict: 'fix' });
  };

  return (
    <View
      style={[
        styles.card,
        verdict ? { borderColor: VERDICT_COLORS[verdict].fg } : null,
        dropped && styles.dropped,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.number}>
          <Text style={styles.numberText}>{index}</Text>
        </View>
        <Badge label={getQuestionLogic(question.format).label} />
        <Badge label={question.difficulty} />
        {current.revisedFrom ? <Badge label="Rewritten" tone="primary" /> : null}
        <View style={styles.spacer} />
        {onEdit && !fixing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit question ${index} by hand`}
            onPress={() => onEdit(question.id)}
            hitSlop={10}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {question.provenance.noteTitle ? (
        <View style={styles.sourceRow}>
          <Ionicons name="document-text-outline" size={13} color={colors.textFaint} />
          <Text style={styles.source} numberOfLines={1}>
            {question.provenance.noteTitle}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.prompt, dropped && styles.struck]} selectable>
        {question.prompt}
      </Text>

      {!dropped ? (
        <>
          <AnswerView
            question={question as never}
            answer={null as never}
            onChange={() => undefined}
            grade={revealed}
            disabled
          />
          <Text style={styles.explanation}>{question.explanation}</Text>
        </>
      ) : null}

      {current.revisedFrom ? (
        <Text style={styles.was} numberOfLines={2}>
          Was: {current.revisedFrom}
        </Text>
      ) : null}

      {current.error ? <Text style={styles.error}>Couldn't rewrite this one: {current.error}</Text> : null}

      {fixing ? (
        <Text style={styles.fixing}>Rewriting with your feedback…</Text>
      ) : onReview ? (
        <>
          <View style={styles.verdicts}>
            {VERDICTS.map((option) => {
              const selected = verdict === option.verdict;
              const tint = VERDICT_COLORS[option.verdict];
              return (
                <Pressable
                  key={option.verdict}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label}, question ${index}`}
                  onPress={() => choose(option.verdict)}
                  style={({ pressed }) => [
                    styles.verdict,
                    selected && { backgroundColor: tint.surface, borderColor: tint.fg },
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons name={option.icon} size={16} color={selected ? tint.fg : colors.textMuted} />
                  <Text style={[styles.verdictLabel, selected && { color: tint.fg }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {verdict === 'fix' ? (
            <View style={styles.reasons}>
              <ChipGroup>
                {FEEDBACK_TAGS.map((info) => (
                  <Chip
                    key={info.tag}
                    label={info.label}
                    selected={current.tags.includes(info.tag)}
                    onPress={() => toggleTag(info.tag)}
                  />
                ))}
              </ChipGroup>
              <TextField
                value={current.note}
                onChangeText={(note) => update({ note })}
                placeholder="What should change? (optional)"
                autoCapitalize="sentences"
                autoCorrect
                multiline
                maxLength={500}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export const DraftCard = memo(DraftCardInner);

const styles = themedSheet(() => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  dropped: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  number: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  numberText: { ...type.micro, color: colors.textMuted },
  spacer: { flex: 1 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  source: { ...type.micro, color: colors.textFaint, flex: 1 },
  prompt: { ...type.bodyStrong, color: colors.text, lineHeight: 22 },
  struck: { textDecorationLine: 'line-through', color: colors.textMuted },
  explanation: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  was: { ...type.small, color: colors.textFaint, fontStyle: 'italic' },
  error: { ...type.small, color: colors.danger },
  fixing: { ...type.smallStrong, color: colors.primary },
  verdicts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  verdict: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  verdictLabel: { ...type.smallStrong, color: colors.textMuted },
  pressed: { opacity: 0.7 },
  reasons: { gap: spacing.sm },
}));
