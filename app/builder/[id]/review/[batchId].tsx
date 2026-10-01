import { useCallback, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Text, View } from 'react-native';

import { keepAndContinue, rethinkWithFeedback } from '../../../../src/quiz/builder/actions';
import { hasFeedback, tallyReviews } from '../../../../src/quiz/builder/feedback';
import { cancelPlanJob, startFixDrafts } from '../../../../src/quiz/builder/runStore';
import { acceptBatch, discardBatch, setDraftReview, updatePlanSettings } from '../../../../src/quiz/builder/store';
import { batchLabel, BATCH_SIZE_CHOICES, type DraftReview } from '../../../../src/quiz/builder/types';
import { usePlan } from '../../../../src/quiz/builder/useBuilder';
import { useQuestions } from '../../../../src/quiz/useQuiz';
import type { Question } from '../../../../src/quiz/types';
import { Button } from '../../../../src/ui/components/Button';
import { Callout } from '../../../../src/ui/components/Callout';
import { Card } from '../../../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../../../src/ui/components/Chip';
import { Disclosure } from '../../../../src/ui/components/Disclosure';
import { DraftCard } from '../../../../src/ui/components/DraftCard';
import { EmptyState } from '../../../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../../../src/ui/components/ErrorBanner';
import { ProgressBar } from '../../../../src/ui/components/ProgressBar';
import { RunNoteRow } from '../../../../src/ui/components/RunNoteRow';
import { Screen } from '../../../../src/ui/components/Screen';
import { colors, radius, spacing, themedSheet, themedTokens, type } from '../../../../src/ui/theme';

/**
 * Reviewing one batch: every draft answered, with Keep / Needs work / Drop on
 * each, then one decision about the lot.
 *
 * Drafts appear AS THEY ARE WRITTEN — reviewing starts with the first note
 * done, not when the last one is. A batch of twenty takes minutes; reading
 * the first five while the rest arrive is most of that time given back.
 *
 * The decision sits after the last card rather than pinned over the list:
 * reading every question first IS the review, and a decision bar floating over
 * question three invites deciding before reading.
 */

type Busy = null | 'fix' | 'next' | 'keep' | 'rethink';

const TALLY_COLORS = themedTokens(() => ({
  keep: colors.success,
  fix: colors.warning,
  drop: colors.danger,
}));

export default function ReviewBatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; batchId: string }>();
  const planId = typeof params.id === 'string' ? params.id : undefined;
  const batchId = typeof params.batchId === 'string' ? params.batchId : undefined;
  const plan = usePlan(planId);
  const batch = plan?.batches.find((entry) => entry.id === batchId);
  const questions = useQuestions();

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<unknown>(null);

  // Stable, so typing feedback into one memoized card re-renders only that card.
  const onReview = useCallback(
    (questionId: string, review: DraftReview) => {
      if (planId && batchId) setDraftReview(planId, batchId, questionId, review);
    },
    [planId, batchId],
  );
  const onEdit = useCallback(
    (questionId: string) => {
      if (planId) router.push(`/builder/${encodeURIComponent(planId)}/draft/${encodeURIComponent(questionId)}`);
    },
    [planId, router],
  );

  /** A kept batch shows what reached the bank — and is still there. */
  const keptQuestions = useMemo(() => {
    if (batch?.status !== 'accepted') return [];
    const ids = new Set(batch.acceptedIds);
    return questions.filter((question) => ids.has(question.id));
  }, [batch, questions]);

  const toOverview = useCallback(() => {
    if (planId) router.dismissTo(`/builder/${encodeURIComponent(planId)}`);
  }, [planId, router]);

  if (!plan || !batch || !planId || !batchId) {
    return (
      <Screen>
        <EmptyState
          icon="help-circle-outline"
          title="Batch not found"
          body="The plan or the batch may have been deleted."
          actionTitle="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const label = batchLabel(plan, batch);
  const tally = tallyReviews(batch);
  const kept = tally.keep + tally.unreviewed;
  const reviewing = batch.status === 'review';
  const writing = batch.status === 'generating';
  const fixing = batch.status === 'fixing';
  const settledNotes = batch.notes.filter((note) => note.status !== 'pending' && note.status !== 'running').length;
  const size = plan.settings.batchSize;
  const isSample = batch.kind === 'sample';
  const fixingIds = fixing
    ? new Set(batch.drafts.filter((draft) => batch.reviews[draft.id]?.verdict === 'fix').map((draft) => draft.id))
    : null;

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<{ ok: boolean; error?: unknown }> | void) => {
    setError(null);
    setBusy(kind);
    try {
      const outcome = await action();
      if (outcome && !outcome.ok) setError(outcome.error);
    } finally {
      setBusy(null);
    }
  };

  const fix = () =>
    run('fix', async () => {
      const outcome = await startFixDrafts(planId, batchId);
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    });

  const next = () =>
    run('next', async () => {
      const outcome = await keepAndContinue(planId, batchId, size);
      if (!outcome.ok) return { ok: false, error: outcome.error };
      // Replace, so Back goes to the plan rather than to a batch already kept.
      router.replace(`/builder/${encodeURIComponent(planId)}/review/${encodeURIComponent(outcome.batchId)}`);
      return { ok: true };
    });

  const keepAndStop = () =>
    run('keep', () => {
      acceptBatch(planId, batchId);
      toOverview();
    });

  const rethink = () =>
    run('rethink', () => {
      if (rethinkWithFeedback(planId, batchId)) {
        router.replace(`/builder/${encodeURIComponent(planId)}/chat`);
      }
    });

  const confirmDiscard = () =>
    Alert.alert(
      `Discard all ${batch.drafts.length}?`,
      'None of these questions will reach your bank. The notes they came from still count as read.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            discardBatch(planId, batchId);
            toOverview();
          },
        },
      ],
    );

  const header = (
    <View style={styles.headerItems}>
      {writing ? (
        <Card title={`Writing ${label.toLowerCase()}…`} icon="sparkles" accent="violet">
          <ProgressBar value={batch.notes.length === 0 ? 0 : settledNotes / batch.notes.length} />
          <Text style={styles.stat}>
            {batch.drafts.length} written so far · {settledNotes} of {batch.notes.length} note
            {batch.notes.length === 1 ? '' : 's'} read
          </Text>
          <Text style={styles.hint}>
            Start reviewing below — the rest appear as they're written. You can leave this screen; it keeps going.
          </Text>
          <Disclosure title="Notes" value={`${settledNotes} of ${batch.notes.length}`}>
            {batch.notes.map((note) => (
              <RunNoteRow key={note.key} note={note} />
            ))}
          </Disclosure>
          <Button title="Stop writing" variant="destructive" onPress={cancelPlanJob} />
        </Card>
      ) : null}

      {fixing ? (
        <Card title={`Rewriting ${fixingIds?.size ?? 0} question${fixingIds?.size === 1 ? '' : 's'}…`} icon="construct-outline" accent="amber">
          <Text style={styles.hint}>Each one gets your feedback. They'll come back here for another look.</Text>
          <Button title="Stop" variant="destructive" onPress={cancelPlanJob} />
        </Card>
      ) : null}

      {reviewing ? (
        <Card
          title={`${batch.drafts.length} question${batch.drafts.length === 1 ? '' : 's'} to review`}
          icon="checkmark-done-outline"
          accent="violet"
        >
          <View style={styles.tally}>
            <TallyPill label="Keep" count={kept} color={TALLY_COLORS.keep} />
            <TallyPill label="Needs work" count={tally.fix} color={TALLY_COLORS.fix} />
            <TallyPill label="Drop" count={tally.drop} color={TALLY_COLORS.drop} />
          </View>
          <Text style={styles.hint}>
            {isSample
              ? 'A taste of the plan, from notes across it. Mark anything off, then decide below.'
              : 'Anything you don’t mark is kept. Say why a question needs work — it’s what improves the next batch.'}
          </Text>
        </Card>
      ) : null}

      {batch.error && (reviewing || batch.status === 'failed') ? (
        <Callout tone={batch.status === 'failed' ? 'danger' : 'warning'} message={batch.error}>
          {batch.status === 'failed' ? <Button title="Back to the plan" variant="secondary" onPress={toOverview} /> : null}
        </Callout>
      ) : null}

      {batch.status === 'accepted' ? (
        <Card title={`Kept ${batch.acceptedIds.length}${batch.discarded > 0 ? ` · discarded ${batch.discarded}` : ''}`} icon="checkmark-circle" accent="success">
          <Text style={styles.hint}>
            {batch.autoAccepted
              ? 'Added straight to your bank on autopilot.'
              : 'These are in your bank. Edit or delete them there like any other question.'}
          </Text>
          <Button
            title="See them in the question bank"
            variant="secondary"
            onPress={() => router.push({ pathname: '/questions', params: { plan: planId } })}
          />
        </Card>
      ) : null}

      {batch.status === 'discarded' ? (
        <Callout tone="info" message="This batch was discarded — none of it reached your bank." />
      ) : null}
    </View>
  );

  const decision = reviewing ? (
    <Card title="What next?" icon="git-branch-outline" accent="primary">
      {tally.fix > 0 ? (
        <>
          <Button title={`Fix ${tally.fix} with your feedback`} onPress={() => void fix()} loading={busy === 'fix'} disabled={busy !== null} />
          <Text style={styles.hint}>Rewrites just those, then brings them back for another look.</Text>
          <Button
            title="Rethink the plan instead"
            variant="secondary"
            onPress={() => void rethink()}
            disabled={busy !== null}
          />
          <Text style={styles.hint}>
            Keeps the {kept} you didn’t flag, and asks the planner to change the plan so the next batch avoids these
            problems.
          </Text>
          <Button
            title={kept > 0 ? `Keep the other ${kept}, discard these` : 'Discard these'}
            variant="plain"
            onPress={() => void keepAndStop()}
            disabled={busy !== null}
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Next batch size</Text>
          <ChipGroup scroll>
            {BATCH_SIZE_CHOICES.map((choice) => (
              <Chip
                key={choice}
                label={String(choice)}
                selected={size === choice}
                onPress={() => updatePlanSettings(planId, { batchSize: choice })}
              />
            ))}
          </ChipGroup>
          <Button
            title={
              kept === 0
                ? `Write ${size} more`
                : isSample && kept === batch.drafts.length
                  ? `Keep these & write ${size}`
                  : `Keep ${kept} & write ${isSample ? '' : 'the next '}${size}`
            }
            onPress={() => void next()}
            loading={busy === 'next'}
            disabled={busy !== null}
          />
          {hasFeedback(batch) ? (
            <>
              <Button
                title="Rethink the plan with this feedback"
                variant="secondary"
                onPress={() => void rethink()}
                disabled={busy !== null}
              />
              <Text style={styles.hint}>Keeps what you didn’t drop, and sends your notes to the planner.</Text>
            </>
          ) : (
            <Button
              title="Change the plan first"
              variant="secondary"
              onPress={() => router.push(`/builder/${encodeURIComponent(planId)}/chat`)}
              disabled={busy !== null}
            />
          )}
          <Button
            title={kept > 0 ? `Keep ${kept} and stop here` : 'Stop here'}
            variant="plain"
            onPress={() => void keepAndStop()}
            disabled={busy !== null}
          />
        </>
      )}
      <Button title="Discard the whole batch" variant="plain" onPress={confirmDiscard} disabled={busy !== null} />
      {error ? <ErrorBanner error={error} /> : null}
    </Card>
  ) : null;

  const usage =
    batch.usage.inputTokens > 0 || batch.usage.outputTokens > 0 ? (
      <Text style={styles.usage}>
        {batch.usage.inputTokens.toLocaleString()} in / {batch.usage.outputTokens.toLocaleString()} out tokens
      </Text>
    ) : null;

  const data: Question[] = batch.status === 'accepted' ? keptQuestions : batch.drafts;

  return (
    <>
      <Stack.Screen options={{ title: label }} />
      {/*
        A FlatList, not the usual Screen: a reader who sets batches of fifty
        before switching on autopilot reviews fifty answered questions here.
        `automaticallyAdjustKeyboardInsets` keeps a feedback field above the
        keyboard without a KeyboardAvoidingView around a scrolling list.
      */}
      <FlatList
        data={data}
        keyExtractor={(question) => question.id}
        renderItem={({ item, index }) => (
          <DraftCard
            question={item}
            index={index + 1}
            review={batch.reviews[item.id]}
            // Open while the batch is still writing, too — reviewing the first
            // drafts as the rest arrive is the point of showing them early.
            onReview={reviewing || writing ? onReview : undefined}
            onEdit={reviewing || writing ? onEdit : undefined}
            fixing={fixingIds?.has(item.id) ?? false}
          />
        )}
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        ListHeaderComponent={header}
        ListFooterComponent={
          <View style={styles.footerItems}>
            {decision}
            {usage}
          </View>
        }
        ListEmptyComponent={
          writing ? (
            <Text style={styles.hint}>The first questions appear here as soon as a note is done.</Text>
          ) : null
        }
      />
    </>
  );
}

function TallyPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={styles.pill}>
      <Text style={[styles.pillCount, { color }]}>{count}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

const styles = themedSheet(() => ({
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerItems: { gap: spacing.md, marginBottom: spacing.xs },
  footerItems: { gap: spacing.md, marginTop: spacing.xs },
  stat: { ...type.bodyStrong, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  label: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  usage: { ...type.small, color: colors.textFaint, textAlign: 'center' },
  tally: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  pillCount: { ...type.heading, fontSize: 20 },
  pillLabel: { ...type.micro, color: colors.textMuted },
}));
