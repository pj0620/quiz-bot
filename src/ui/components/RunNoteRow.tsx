import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { NoteStatus, RunNote } from '../../quiz/generation/runStore';
import { colors, radius, spacing, themedSheet, type } from '../theme';

/**
 * One note in a generation run: what it is called, where it has got to, and
 * what it produced.
 *
 * Replaces a bare "3 of 10 notes processed". A count answers how far along the
 * run is and nothing else — not which note is being worked on, not whether the
 * one that just finished was worth anything, not which of them failed. All of
 * that is visible here without waiting for the run to end.
 */

const PRESENTATION: Record<
  NoteStatus,
  { label: string; icon: keyof typeof Ionicons.glyphMap | null; color: string }
> = {
  pending: { label: 'Waiting', icon: 'ellipse-outline', color: colors.textFaint },
  running: { label: 'Working', icon: null, color: colors.primary },
  done: { label: 'Done', icon: 'checkmark-circle', color: colors.success },
  failed: { label: 'Failed', icon: 'alert-circle', color: colors.danger },
  skipped: { label: 'Skipped', icon: 'remove-circle-outline', color: colors.textFaint },
};

/** The right-hand column: what this note yielded, or why it didn't. */
function outcomeOf(note: RunNote): string {
  if (note.status === 'failed') return 'failed';
  if (note.status !== 'done') return PRESENTATION[note.status].label;
  // Not an error — a page of screenshots has real headings and nothing to ask
  // about. A green tick beside a bare "0" reads as a bug.
  if (note.questionCount === 0) return 'nothing to ask';
  return `${note.questionCount} question${note.questionCount === 1 ? '' : 's'}`;
}

export function RunNoteRow({ note }: { note: RunNote }) {
  const presentation = PRESENTATION[note.status];
  const active = note.status === 'running';

  return (
    <View style={[styles.row, active && styles.rowActive]}>
      <View style={styles.icon}>
        {presentation.icon ? (
          <Ionicons name={presentation.icon} size={16} color={presentation.color} />
        ) : (
          // A spinner rather than an icon: this is the only row where something
          // is actually happening, and it should be the one thing that moves.
          <ActivityIndicator size="small" color={colors.primary} />
        )}
      </View>

      <View style={styles.body}>
        {/*
          Two lines, because these are full vault filenames and one line cuts
          "Thinking Fast and Slow 11 Anchoring.md" down to the part that
          identifies it least.
        */}
        <Text
          style={[styles.title, note.status === 'pending' && styles.titleMuted]}
          numberOfLines={2}
        >
          {note.title}
        </Text>
        {note.error ? (
          <Text style={styles.error} numberOfLines={2}>
            {note.error}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.outcome, { color: presentation.color }]} numberOfLines={1}>
        {outcomeOf(note)}
      </Text>
    </View>
  );
}

const styles = themedSheet(() => ({
  // Top-aligned so the icon stays level with the first line of a wrapped name.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  // The row in progress is lifted out of the list rather than merely coloured,
  // so it can be found at a glance in a list of seventy.
  rowActive: { backgroundColor: colors.surfaceRaised },
  icon: { width: 20, alignItems: 'center', paddingTop: 1 },
  body: { flex: 1, gap: 2 },
  title: { ...type.small, color: colors.text },
  titleMuted: { color: colors.textMuted },
  error: { ...type.micro, color: colors.danger },
  outcome: { ...type.micro, textAlign: 'right' },
}));
