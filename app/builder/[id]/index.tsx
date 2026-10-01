import { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Switch, Text, View } from 'react-native';

import { noteStem } from '../../../src/notes/paths';
import { coverageKey } from '../../../src/quiz/generation/coverage';
import { acceptAndWrite, removePlan } from '../../../src/quiz/builder/actions';
import { refreshCatalog } from '../../../src/quiz/builder/notesCatalog';
import { diffSpecs } from '../../../src/quiz/builder/planSpec';
import { cancelPlanJob, startPlanBatch, type StartBatchOptions } from '../../../src/quiz/builder/runStore';
import { orderForBatch, planProgress } from '../../../src/quiz/builder/selection';
import { createPlanQuiz, markNotesSeen, updatePlanSettings } from '../../../src/quiz/builder/store';
import {
  batchLabel,
  BATCH_SIZE_CHOICES,
  DEPTH_CHOICES,
  hasKeptAnything,
  hasKeptBatch,
  hasUnacceptedChanges,
  MAX_BATCH_SIZE,
  openBatch,
  planTitle,
  totalUsage,
  type PlanBatch,
  type QuizPlan,
} from '../../../src/quiz/builder/types';
import {
  useCatalog,
  useFreshNotes,
  usePlan,
  usePlanQuestions,
  usePlanRun,
  useScopeNotes,
} from '../../../src/quiz/builder/useBuilder';
import { startQuizSession } from '../../../src/quiz/startSession';
import { getQuizById } from '../../../src/quiz/store';
import { useQuiz } from '../../../src/quiz/useQuiz';
import { Button } from '../../../src/ui/components/Button';
import { Callout } from '../../../src/ui/components/Callout';
import { Card } from '../../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../../src/ui/components/Chip';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../../src/ui/components/ErrorBanner';
import { HeaderIconButton } from '../../../src/ui/components/HeaderIconButton';
import { ListRow } from '../../../src/ui/components/ListRow';
import { LoadingBlock } from '../../../src/ui/components/LoadingBlock';
import { PlanSpecView } from '../../../src/ui/components/PlanSpecView';
import { ProgressBar } from '../../../src/ui/components/ProgressBar';
import { RunNoteRow } from '../../../src/ui/components/RunNoteRow';
import { Screen } from '../../../src/ui/components/Screen';
import { SectionHeader } from '../../../src/ui/components/SectionHeader';
import { SegmentedControl } from '../../../src/ui/components/SegmentedControl';
import { StatRow } from '../../../src/ui/components/StatRow';
import { colors, spacing, themedSheet, type } from '../../../src/ui/theme';

/**
 * A plan's home: what it is, what it has made, and — first, always — the one
 * thing worth doing next.
 *
 * The "next step" card is the screen's spine. A plan moves through drafting,
 * sampling, reviewing and running, and at every point exactly one action
 * moves it forward; putting that action at the top, worded for the moment, is
 * what keeps the reader from having to work out the flow from a page of
 * controls. Everything below it is reference and settings.
 */

/** Notes previewed on the overview before "see all". */
const NOTES_SHOWN = 6;

const MODE_OPTIONS = [
  { value: 'review' as const, label: 'Review each batch' },
  { value: 'autopilot' as const, label: 'Autopilot' },
];

const DEPTH_LABELS: Record<number, string> = { 1: 'Once', 2: 'Twice', 3: 'Three times' };

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function batchSubtitle(batch: PlanBatch): string {
  switch (batch.status) {
    case 'generating':
      return `Writing · ${batch.drafts.length} so far`;
    case 'fixing':
      return 'Rewriting the questions you flagged';
    case 'review':
      return `Waiting for your review · ${batch.drafts.length} question${batch.drafts.length === 1 ? '' : 's'}`;
    case 'accepted':
      return `${batch.autoAccepted ? 'Added' : 'Kept'} ${batch.acceptedIds.length}${
        batch.discarded > 0 ? ` · discarded ${batch.discarded}` : ''
      } · ${formatDay(batch.settledAt ?? batch.createdAt)}`;
    case 'discarded':
      return `Discarded · ${formatDay(batch.settledAt ?? batch.createdAt)}`;
    case 'failed':
      return batch.error ?? 'Produced nothing';
  }
}

export default function PlanOverviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const planId = typeof params.id === 'string' ? params.id : undefined;
  const plan = usePlan(planId);
  const run = usePlanRun();
  const catalog = useCatalog();
  const scopeNotes = useScopeNotes(plan?.accepted ?? plan?.spec);
  const fresh = useFreshNotes(plan);
  const planQuestions = usePlanQuestions(planId);
  const quiz = useQuiz(plan?.quizId);

  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The scope is evaluated against the live listing; a note written since the
  // last visit should show up here as soon as the plan is opened.
  useFocusEffect(
    useCallback(() => {
      void refreshCatalog();
    }, []),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCatalog({ maxAgeMs: 0 });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const remaining = useMemo(
    () =>
      plan?.accepted
        ? orderForBatch({ matched: scopeNotes, coverage: plan.coverage, seen: plan.seen, depth: plan.settings.depth })
        : [],
    [plan, scopeNotes],
  );

  if (!plan || !planId) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title="Plan not found" actionTitle="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  const spec = plan.accepted ?? plan.spec;
  const progress = planProgress(scopeNotes, plan.coverage, plan.settings.depth);
  const keptBatches = plan.batches.filter((batch) => batch.status === 'accepted').length;
  const usage = totalUsage(plan);
  const otherPlanBusy = run.job !== null && run.job.planId !== plan.id;
  const listed = catalog.notes.length > 0;

  const begin = async (key: string, options: StartBatchOptions) => {
    setError(null);
    setStarting(key);
    try {
      const outcome = await startPlanBatch(plan.id, options);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      router.push(`/builder/${encodeURIComponent(plan.id)}/review/${encodeURIComponent(outcome.batchId)}`);
    } finally {
      setStarting(null);
    }
  };

  const acceptAndGo = async () => {
    setError(null);
    setStarting('accept');
    try {
      const outcome = await acceptAndWrite(plan.id);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      router.push(`/builder/${encodeURIComponent(plan.id)}/review/${encodeURIComponent(outcome.batchId)}`);
    } finally {
      setStarting(null);
    }
  };

  const practise = () => {
    const quizId = (plan.quizId && getQuizById(plan.quizId) ? plan.quizId : undefined) ?? createPlanQuiz(plan.id);
    const target = quizId ? getQuizById(quizId) : undefined;
    const result = target ? startQuizSession(target) : null;
    if (!result) {
      Alert.alert('Nothing to practise yet', 'Keep a batch first, then its questions appear here.');
      return;
    }
    router.push(`/session/${encodeURIComponent(result.session.id)}`);
  };

  const confirmDelete = () => {
    const count = planQuestions.length;
    const remove = (withQuestions: boolean) => {
      removePlan(plan.id, { withQuestions });
      router.back();
    };
    Alert.alert(
      'Delete this plan?',
      count > 0
        ? `Its conversation and history go. Its ${count} question${count === 1 ? '' : 's'} can go with it, or stay in your bank.`
        : 'Its conversation and history go with it.',
      count > 0
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: `Delete plan and ${count} question${count === 1 ? '' : 's'}`, style: 'destructive', onPress: () => remove(true) },
            { text: 'Delete plan, keep questions', onPress: () => remove(false) },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => remove(false) },
          ],
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: planTitle(plan),
          headerRight: () => (
            <HeaderIconButton
              name="chatbubbles-outline"
              accessibilityLabel="Plan with AI"
              onPress={() => router.push(`/builder/${encodeURIComponent(plan.id)}/chat`)}
            />
          ),
        }}
      />
      <Screen onRefresh={() => void refresh()} refreshing={refreshing}>
        <NextStep
          plan={plan}
          remaining={remaining.length}
          fresh={fresh.map((note) => noteStem(note.path))}
          starting={starting}
          otherPlanBusy={otherPlanBusy}
          onBegin={(key, options) => void begin(key, options)}
          onAcceptAndWrite={() => void acceptAndGo()}
          onDismissFresh={() => markNotesSeen(plan.id, fresh)}
        />
        {error ? <ErrorBanner error={error} /> : null}

        {plan.accepted ? (
          <StatRow
            stats={[
              { label: 'In your bank', value: planQuestions.length, tone: planQuestions.length > 0 ? 'default' : 'muted' },
              { label: 'Notes read', value: listed ? `${progress.read}/${progress.total}` : '—', tone: 'default' },
              { label: 'Batches kept', value: keptBatches, tone: keptBatches > 0 ? 'default' : 'muted' },
            ]}
          />
        ) : null}

        {spec ? (
          <Card title="The plan" icon="document-text-outline" accent="violet">
            <PlanSpecView spec={spec} noteCount={listed ? scopeNotes.length : undefined} />
            <View style={styles.buttonRow}>
              <Button
                title="Change it by chatting"
                variant="secondary"
                style={styles.grow}
                onPress={() => router.push(`/builder/${encodeURIComponent(plan.id)}/chat`)}
              />
              <Button
                title="Edit"
                variant="plain"
                onPress={() => router.push(`/builder/${encodeURIComponent(plan.id)}/edit`)}
              />
            </View>
          </Card>
        ) : null}

        {spec ? (
          <Card
            title={`Notes${listed ? ` · ${scopeNotes.length}` : ''}`}
            icon="documents-outline"
            accent="teal"
            onPress={() => router.push(`/builder/${encodeURIComponent(plan.id)}/edit`)}
          >
            {!listed && catalog.status === 'loading' ? (
              <LoadingBlock message="Listing your notes…" size="inline" />
            ) : !listed && catalog.error ? (
              <ErrorBanner error={catalog.error} onRetry={() => void refreshCatalog({ maxAgeMs: 0 })} />
            ) : (
              <>
                {scopeNotes.slice(0, NOTES_SHOWN).map((note) => {
                  const read = (plan.coverage[coverageKey(note.sourceId, note.path)]?.passes ?? 0) > 0;
                  return (
                    <View key={`${note.sourceId}:${note.path}`} style={styles.noteRow}>
                      <Ionicons
                        name={read ? 'checkmark-circle' : 'ellipse-outline'}
                        size={15}
                        color={read ? colors.success : colors.textFaint}
                      />
                      <Text style={styles.noteName} numberOfLines={1}>
                        {noteStem(note.path)}
                      </Text>
                    </View>
                  );
                })}
                {scopeNotes.length > NOTES_SHOWN ? (
                  <Text style={styles.hint}>…and {scopeNotes.length - NOTES_SHOWN} more. Tap to see and adjust.</Text>
                ) : (
                  <Text style={styles.hint}>Tap to see and adjust which notes it reads.</Text>
                )}
              </>
            )}
          </Card>
        ) : null}

        {plan.accepted ? (
          <Card title="Quiz yourself" icon="play-circle-outline" accent="success">
            {planQuestions.length === 0 ? (
              <Text style={styles.hint}>Questions you keep land in your bank — and in this plan’s own quiz.</Text>
            ) : (
              <>
                <Button title={`Practise ${planQuestions.length} question${planQuestions.length === 1 ? '' : 's'}`} onPress={practise} />
                <Button
                  title="See them in the question bank"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/questions', params: { plan: plan.id } })}
                />
                {quiz ? (
                  <Button
                    title="Open the quiz"
                    variant="plain"
                    onPress={() => router.push(`/quiz/${encodeURIComponent(quiz.id)}`)}
                  />
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        {plan.accepted ? (
          <Card title="How it runs" icon="options-outline" accent="amber">
            <SegmentedControl
              options={MODE_OPTIONS}
              value={plan.settings.mode}
              onChange={(mode) => updatePlanSettings(plan.id, { mode })}
            />
            <Text style={styles.hint}>
              {plan.settings.mode === 'autopilot'
                ? 'Batches go straight into your bank. Samples still wait for you.'
                : 'Every batch waits for you to keep, fix or drop its questions.'}
            </Text>

            <View style={styles.switchRow}>
              <View style={styles.grow}>
                <Text style={styles.switchTitle}>Write questions for new notes</Text>
                <Text style={styles.hint}>
                  When a note matching this plan turns up, write questions for it the next time you open the app.
                </Text>
              </View>
              <Switch
                value={plan.settings.autoNewNotes}
                onValueChange={(autoNewNotes) => updatePlanSettings(plan.id, { autoNewNotes })}
                trackColor={{ true: colors.primary, false: colors.surfaceActive }}
              />
            </View>

            <Text style={styles.label}>Read each note</Text>
            <ChipGroup>
              {DEPTH_CHOICES.map((depth) => (
                <Chip
                  key={depth}
                  label={DEPTH_LABELS[depth]}
                  selected={plan.settings.depth === depth}
                  onPress={() => updatePlanSettings(plan.id, { depth })}
                />
              ))}
            </ChipGroup>
            <Text style={styles.hint}>
              Reading a note again asks new questions about it, never the same ones reworded.
            </Text>
          </Card>
        ) : null}

        {plan.batches.length > 0 ? (
          <View style={styles.list}>
            <SectionHeader title="History" accent="violet" />
            {[...plan.batches].reverse().map((batch) => (
              <ListRow
                key={batch.id}
                title={batchLabel(plan, batch)}
                subtitle={batchSubtitle(batch)}
                icon={
                  batch.status === 'accepted'
                    ? 'checkmark-circle-outline'
                    : batch.status === 'review'
                      ? 'alert-circle-outline'
                      : batch.status === 'failed'
                        ? 'close-circle-outline'
                        : 'time-outline'
                }
                iconColor={batch.status === 'review' ? colors.warning : undefined}
                onPress={() =>
                  router.push(`/builder/${encodeURIComponent(plan.id)}/review/${encodeURIComponent(batch.id)}`)
                }
                showChevron
              />
            ))}
          </View>
        ) : null}

        {usage.inputTokens > 0 || usage.outputTokens > 0 ? (
          <Text style={styles.usage}>
            {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out tokens spent on this plan
          </Text>
        ) : null}

        <Button title="Delete this plan" variant="destructive" onPress={confirmDelete} />
      </Screen>
    </>
  );
}

type NextStepProps = {
  plan: QuizPlan;
  /** Notes a batch could still read. */
  remaining: number;
  /** Names of notes that turned up since the plan's baseline. */
  fresh: string[];
  starting: string | null;
  otherPlanBusy: boolean;
  onBegin: (key: string, options: StartBatchOptions) => void;
  onAcceptAndWrite: () => void;
  onDismissFresh: () => void;
};

/**
 * The one action that moves this plan forward, worded for where it stands.
 * The order of the checks is the order of priority — see `planStatus`, which
 * makes the same call for the Build tab's rows.
 */
function NextStep({
  plan,
  remaining,
  fresh,
  starting,
  otherPlanBusy,
  onBegin,
  onAcceptAndWrite,
  onDismissFresh,
}: NextStepProps) {
  const router = useRouter();
  const run = usePlanRun();
  const job = run.job?.planId === plan.id ? run.job : null;
  const open = openBatch(plan);
  const size = plan.settings.batchSize;
  const perNote = plan.accepted?.questionsPerNote ?? 1;
  const busy = starting !== null || otherPlanBusy;
  const toReview = (batchId: string) =>
    router.push(`/builder/${encodeURIComponent(plan.id)}/review/${encodeURIComponent(batchId)}`);
  const toChat = () => router.push(`/builder/${encodeURIComponent(plan.id)}/chat`);
  const busyNote = otherPlanBusy ? (
    <Text style={styles.hint}>Another plan is writing right now — this can start when it finishes.</Text>
  ) : null;

  if (job && open) {
    const settled = open.notes.filter((note) => note.status !== 'pending' && note.status !== 'running').length;
    return (
      <Card title={job.kind === 'fix' ? 'Rewriting flagged questions' : `Writing ${batchLabel(plan, open).toLowerCase()}`} icon="sparkles" accent="violet" tone="raised">
        {job.kind === 'generate' ? (
          <>
            <ProgressBar value={open.notes.length === 0 ? 0 : settled / open.notes.length} />
            <Text style={styles.stat}>
              {open.drafts.length} written · {settled} of {open.notes.length} note{open.notes.length === 1 ? '' : 's'} read
            </Text>
            {open.notes.filter((note) => note.status === 'running').map((note) => (
              <RunNoteRow key={note.key} note={note} />
            ))}
          </>
        ) : null}
        <Button title="Watch and review" onPress={() => toReview(open.id)} />
        <Button title="Stop" variant="plain" onPress={cancelPlanJob} />
      </Card>
    );
  }

  if (open?.status === 'review') {
    return (
      <Card title={`${batchLabel(plan, open)} is ready`} icon="checkmark-done-outline" accent="violet" tone="raised">
        <Text style={styles.stat}>
          {open.drafts.length} question{open.drafts.length === 1 ? '' : 's'} waiting for your review
        </Text>
        <Button title="Review now" onPress={() => toReview(open.id)} />
      </Card>
    );
  }

  if (!plan.accepted) {
    return (
      <Card title="Finish the plan" icon="chatbubbles-outline" accent="violet" tone="raised">
        <Text style={styles.hint}>
          {plan.spec
            ? `The planner has proposed v${plan.spec.version}. Refine it, or accept it to try sample questions.`
            : 'The planner is working on a first draft of your plan.'}
        </Text>
        <Button title="Continue planning" onPress={toChat} />
      </Card>
    );
  }

  if (hasUnacceptedChanges(plan) && plan.spec) {
    const changes = diffSpecs(plan.accepted, plan.spec);
    return (
      <Card title={`Plan v${plan.spec.version} is waiting`} icon="git-compare-outline" accent="primary" tone="raised">
        {changes.slice(0, 6).map((line) => (
          <Text key={line} style={styles.change}>
            {line}
          </Text>
        ))}
        <Button
          title={hasKeptBatch(plan) ? `Accept & write ${size}` : 'Accept & try samples'}
          onPress={onAcceptAndWrite}
          loading={starting === 'accept'}
          disabled={busy}
        />
        <Button title="Talk it over first" variant="plain" onPress={toChat} />
        {busyNote}
      </Card>
    );
  }

  if (fresh.length > 0) {
    return (
      <Card title={`${fresh.length} new note${fresh.length === 1 ? '' : 's'} for this plan`} icon="leaf-outline" accent="teal" tone="raised">
        {fresh.slice(0, 5).map((name) => (
          <Text key={name} style={styles.change} numberOfLines={1}>
            · {name}
          </Text>
        ))}
        {fresh.length > 5 ? <Text style={styles.hint}>…and {fresh.length - 5} more</Text> : null}
        <Button
          title="Write questions for them"
          onPress={() => onBegin('fresh', { kind: 'new-notes' })}
          loading={starting === 'fresh'}
          disabled={busy}
        />
        <Button title="Not now" variant="plain" onPress={onDismissFresh} />
        {busyNote}
      </Card>
    );
  }

  if (!hasKeptAnything(plan)) {
    return (
      <Card title="Try the plan out" icon="flask-outline" accent="violet" tone="raised">
        <Text style={styles.hint}>
          Five sample questions from across your notes show whether the plan works — before it writes the rest.
        </Text>
        <Button
          title="Write 5 sample questions"
          onPress={() => onBegin('sample', { kind: 'sample' })}
          loading={starting === 'sample'}
          disabled={busy}
        />
        <Button
          title={`Skip samples — write ${size}`}
          variant="plain"
          onPress={() => onBegin('batch', { kind: 'batch' })}
          disabled={busy}
        />
        {busyNote}
      </Card>
    );
  }

  if (remaining > 0) {
    const all = Math.min(MAX_BATCH_SIZE, remaining * perNote);
    return (
      <Card title="Write the next batch" icon="add-circle-outline" accent="violet" tone="raised">
        <ChipGroup scroll>
          {BATCH_SIZE_CHOICES.filter((choice) => choice < all).map((choice) => (
            <Chip
              key={choice}
              label={String(choice)}
              selected={size === choice}
              onPress={() => updatePlanSettings(plan.id, { batchSize: choice })}
            />
          ))}
          <Chip
            label={`All · ${all}`}
            selected={size >= all}
            onPress={() => updatePlanSettings(plan.id, { batchSize: all })}
          />
        </ChipGroup>
        <Button
          title={`Write ${Math.min(size, all)} questions`}
          onPress={() => onBegin('batch', { kind: 'batch', size: Math.min(size, all) })}
          loading={starting === 'batch'}
          disabled={busy}
        />
        <Text style={styles.hint}>
          {remaining} note{remaining === 1 ? '' : 's'} left to read, about {perNote} question{perNote === 1 ? '' : 's'} each.{' '}
          {plan.settings.mode === 'autopilot' ? 'On autopilot: they go straight into your bank.' : 'You’ll review them before they’re kept.'}
        </Text>
        {busyNote}
      </Card>
    );
  }

  const deeper = plan.settings.depth < DEPTH_CHOICES[DEPTH_CHOICES.length - 1];
  return (
    <Card title="Every note is covered" icon="trophy-outline" accent="success" tone="raised">
      <Text style={styles.hint}>
        This plan has read all of its notes {plan.settings.depth === 1 ? 'once' : `${plan.settings.depth} times`}. Go
        deeper for new questions on the same notes, or widen the plan to take in more.
      </Text>
      {deeper ? (
        <Button
          title="Read every note again"
          onPress={() => {
            updatePlanSettings(plan.id, { depth: plan.settings.depth + 1 });
            onBegin('batch', { kind: 'batch' });
          }}
          loading={starting === 'batch'}
          disabled={busy}
        />
      ) : null}
      <Button title="Widen the plan" variant={deeper ? 'plain' : 'primary'} onPress={toChat} />
      <Callout tone="info" message="New notes that match the plan still get questions as they turn up." />
      {busyNote}
    </Card>
  );
}

const styles = themedSheet(() => ({
  grow: { flex: 1 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stat: { ...type.bodyStrong, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  label: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  change: { ...type.small, color: colors.text },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noteName: { ...type.small, color: colors.text, flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchTitle: { ...type.bodyStrong, fontSize: 15, color: colors.text },
  list: { gap: spacing.sm },
  usage: { ...type.small, color: colors.textFaint, textAlign: 'center' },
}));
