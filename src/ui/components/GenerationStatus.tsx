import {
  useRouter } from 'expo-router';
import { ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { runStore, type RunNote, type RunState } from '../../quiz/generation/runStore';
import { ProgressBar } from './ProgressBar';
import { colors, radius, spacing, themedSheet, type } from '../theme';

/**
 * A generation run, shown somewhere other than the screen that started it.
 *
 * A run now outlives the Generate screen, which is what makes it useful — you
 * can start ten notes and go and do something else. But it also made the run
 * invisible: pressing back left it going with nothing anywhere saying so, and
 * the only route back was tapping "Generate questions" again, which reads like
 * starting a second one.
 *
 * Renders nothing when no run has happened, so it costs nothing to place on a
 * screen that usually has no run to report.
 */

function summarise(run: RunState): { done: number; running: RunNote[] } {
  let done = 0;
  const running: RunNote[] = [];
  for (const note of run.notes) {
    if (note.status === 'running') running.push(note);
    else if (note.status !== 'pending') done += 1;
  }
  return { done, running };
}

/** What is being worked on right now, named rather than counted where possible. */
function workingOn(running: readonly RunNote[]): string | null {
  if (running.length === 0) return null;
  if (running.length === 1) return running[0].title;
  return `${running[0].title} + ${running.length - 1} more`;
}

export function GenerationStatus() {
  const router = useRouter();
  const run = runStore.use();

  if (run.status === 'idle') return null;

  const { done, running } = summarise(run);
  const active = run.status === 'running';
  const open = () => router.push('/generate');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        active ? `Generating questions, ${done} of ${run.notes.length} notes done` : 'See the last run'
      }
      onPress={open}
      style={({ pressed }) => [styles.card, active && styles.cardActive, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={styles.icon}>
          {active ? (
            // The one thing on the screen that moves, which is the whole point:
            // it has to read as "still going" at a glance.
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name={run.status === 'cancelled' ? 'remove-circle-outline' : 'checkmark-circle'}
              size={18}
              color={run.status === 'cancelled' ? colors.textMuted : colors.success}
            />
          )}
        </View>

        <View style={styles.text}>
          <Text style={styles.title}>
            {active
              ? 'Generating questions'
              : run.status === 'cancelled'
                ? 'Generation cancelled'
                : 'Generation finished'}
          </Text>
          <Text style={styles.detail}>
            {run.added} question{run.added === 1 ? '' : 's'} from {done} of {run.notes.length} note
            {run.notes.length === 1 ? '' : 's'}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </View>

      {active ? (
        <>
          <ProgressBar value={run.notes.length === 0 ? 0 : done / run.notes.length} height={6} />
          {/*
            The note being worked on, not just how many are left. It is the
            difference between "something is happening" and being able to tell
            whether the run has actually moved since you last looked.
          */}
          <Text style={styles.working} numberOfLines={1}>
            {workingOn(running) ?? 'Looking at your notes…'}
          </Text>
        </>
      ) : (
        <Text style={styles.working}>Tap to see what it produced.</Text>
      )}
    </Pressable>
  );
}

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
  /*
    A tinted fill and border while the run is live, so it separates from the
    cards around it without needing to be bigger than them. A finished run is
    an ordinary card — worth finding, not worth pulling the eye to.
  */
  cardActive: { backgroundColor: colors.primarySurface, borderColor: colors.primary },
  pressed: { backgroundColor: colors.surfaceActive },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 20, alignItems: 'center' },
  text: { flex: 1, gap: 1 },
  title: { ...type.bodyStrong, color: colors.text },
  detail: { ...type.small, color: colors.textMuted },
  working: { ...type.micro, color: colors.textMuted },
}));
