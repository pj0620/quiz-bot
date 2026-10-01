import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { DIFFICULTY_LABELS, formatLabels } from '../../quiz/builder/planSpec';
import { describeScope } from '../../quiz/builder/scope';
import type { PlanSpec } from '../../quiz/builder/types';
import { colors, radius, spacing, themedSheet, type } from '../theme';
import { Badge } from './Badge';

type Props = {
  spec: PlanSpec;
  /** How many notes the scope matches right now, when the listing is in. */
  noteCount?: number;
  /** Show the bullet lists and style notes, not just the headline. */
  full?: boolean;
  /** A version the reader has not accepted yet. */
  pending?: boolean;
};

/**
 * A plan, as the reader sees it: what it is for, which notes it reads, and —
 * in full — what it asks about and leaves alone.
 *
 * Laid out as a short document rather than as form fields, because reading it
 * is the whole job at the moment it is shown: the reader is deciding whether
 * this is the quiz they meant. The meta chips go last, since formats and
 * difficulty are the parts people least often change.
 */
export function PlanSpecView({ spec, noteCount, full = true, pending = false }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{spec.title}</Text>
        <Badge label={`v${spec.version}${spec.author === 'user' ? ' · yours' : ''}`} tone={pending ? 'primary' : 'neutral'} />
      </View>

      {spec.summary ? <Text style={styles.summary}>{spec.summary}</Text> : null}

      <View style={styles.scopeRow}>
        <Ionicons name="documents-outline" size={15} color={colors.textMuted} />
        <Text style={styles.scope}>
          {describeScope(spec.scope)}
          {noteCount !== undefined ? ` · ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      {noteCount === 0 ? (
        <Text style={styles.warning}>No notes match — ask the planner to fix it, or edit the plan.</Text>
      ) : null}

      {full && spec.focus.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Ask about</Text>
          {spec.focus.map((item) => (
            <View key={item} style={styles.bullet}>
              <Ionicons name="checkmark" size={15} color={colors.success} style={styles.bulletIcon} />
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {full && spec.avoid.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Leave alone</Text>
          {spec.avoid.map((item) => (
            <View key={item} style={styles.bullet}>
              <Ionicons name="close" size={15} color={colors.danger} style={styles.bulletIcon} />
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.meta}>
        <MetaChip icon="shapes-outline" text={formatLabels(spec.formats)} />
        <MetaChip icon="speedometer-outline" text={DIFFICULTY_LABELS[spec.difficulty]} />
        <MetaChip icon="layers-outline" text={`${spec.questionsPerNote} per note`} />
      </View>

      {full && spec.style ? <Text style={styles.style}>“{spec.style}”</Text> : null}
    </View>
  );
}

function MetaChip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={13} color={colors.textMuted} />
      <Text style={styles.metaText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = themedSheet(() => ({
  root: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...type.heading, fontSize: 18, color: colors.text, flex: 1 },
  summary: { ...type.body, fontSize: 15, color: colors.textMuted, lineHeight: 21 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  scope: { ...type.smallStrong, color: colors.text, flex: 1 },
  warning: { ...type.small, color: colors.warning },
  list: { gap: spacing.xs, marginTop: spacing.xs },
  label: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletIcon: { marginTop: 2 },
  bulletText: { ...type.small, color: colors.text, flex: 1, lineHeight: 19 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  metaText: { ...type.micro, color: colors.textMuted },
  style: { ...type.small, color: colors.textMuted, fontStyle: 'italic' },
}));
