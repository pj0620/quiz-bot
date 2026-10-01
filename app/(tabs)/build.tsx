import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Text, View } from 'react-native';

import { useGeneratorId } from '../../src/features/llm/useLlm';
import { startNewPlan } from '../../src/quiz/builder/actions';
import { suggestRequests } from '../../src/quiz/builder/catalog';
import { refreshCatalog } from '../../src/quiz/builder/notesCatalog';
import { planStatus } from '../../src/quiz/builder/status';
import { MAX_REQUEST_CHARS, planTitle, type QuizPlan } from '../../src/quiz/builder/types';
import {
  useCatalog,
  useFreshNotes,
  usePlanQuestions,
  usePlanRun,
  usePlannerTurn,
  usePlans,
} from '../../src/quiz/builder/useBuilder';
import { checkPlansForNewNotes } from '../../src/quiz/builder/watcher';
import { useSources } from '../../src/sources/useSources';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { ListRow } from '../../src/ui/components/ListRow';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { TextField } from '../../src/ui/components/TextField';
import { colors, radius, spacing, themedSheet, type } from '../../src/ui/theme';

/**
 * The quiz builder's home: start a plan in one sentence, and see every plan
 * with what it is waiting for.
 *
 * The request box is on the tab itself rather than behind a "New plan"
 * button, because describing the quiz IS the first step — anything in front
 * of it is a tap spent getting to where the work starts.
 */

const STEPS: { title: string; body: string }[] = [
  { title: 'Describe it', body: 'Say what to quiz you on and which notes to use.' },
  { title: 'Agree a plan', body: 'The AI drafts a plan. Refine it by chatting, or edit it yourself.' },
  { title: 'Try samples', body: 'Five sample questions show whether the plan works before you commit.' },
  {
    title: 'Review batches',
    body: 'It writes questions in batches. Keep, fix or drop each one — your feedback sharpens the plan.',
  },
  {
    title: 'Let it run',
    body: 'Once you trust it, raise the batch size or switch on autopilot. New notes get questions automatically.',
  },
];

function PlanRow({ plan }: { plan: QuizPlan }) {
  const router = useRouter();
  const run = usePlanRun();
  const turn = usePlannerTurn(plan.id);
  const fresh = useFreshNotes(plan);
  const questions = usePlanQuestions(plan.id);
  const status = planStatus(plan, {
    job: run.job,
    thinking: !!turn?.thinking,
    freshCount: fresh.length,
    questionCount: questions.length,
  });

  return (
    <ListRow
      title={planTitle(plan)}
      subtitle={status.detail}
      icon={status.needsYou ? 'alert-circle-outline' : 'construct-outline'}
      iconColor={status.needsYou ? colors.warning : undefined}
      // A plan nobody has agreed yet only has a conversation to show.
      onPress={() =>
        router.push(
          plan.accepted
            ? `/builder/${encodeURIComponent(plan.id)}`
            : `/builder/${encodeURIComponent(plan.id)}/chat`,
        )
      }
      accessory={<Badge label={status.label} tone={status.tone} />}
      showChevron
    />
  );
}

export default function BuildScreen() {
  const router = useRouter();
  const plans = usePlans();
  const sources = useSources();
  const generatorId = useGeneratorId();
  const catalog = useCatalog();
  const [request, setRequest] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  /*
    On focus rather than on mount: tabs stay mounted, and this is where a
    note written since the last visit should show up — as a suggestion here,
    and as "new notes" on the plans below.
  */
  useFocusEffect(
    useCallback(() => {
      if (sources.length === 0) return;
      void refreshCatalog();
      void checkPlansForNewNotes();
    }, [sources.length]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCatalog({ maxAgeMs: 0 });
      await checkPlansForNewNotes({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const suggestions = useMemo(() => suggestRequests(catalog.notes), [catalog.notes]);

  const needsModel = generatorId === 'mock';
  const needsNotes = sources.length === 0;
  const canStart = !needsModel && !needsNotes && request.trim().length > 0;

  const start = useCallback(() => {
    if (!canStart) return;
    const plan = startNewPlan(request);
    setRequest('');
    router.push(`/builder/${encodeURIComponent(plan.id)}/chat`);
  }, [canStart, request, router]);

  return (
    <>
      <Tabs.Screen options={{ title: 'Build' }} />
      <Screen onRefresh={sources.length > 0 ? () => void refresh() : undefined} refreshing={refreshing}>
        <Card title="Build a quiz with AI" icon="sparkles" accent="violet">
          <Text style={styles.hint}>
            Describe the quiz you want and which of your notes it should use. You'll agree a plan together, try a
            few sample questions, then it writes the rest in batches you review.
          </Text>
          <TextField
            value={request}
            onChangeText={setRequest}
            placeholder="e.g. All my Thinking Fast and Slow notes — the big ideas and the biases, not the experiments"
            maxLength={MAX_REQUEST_CHARS}
            autoCapitalize="sentences"
            autoCorrect
            multiline
            editable={!needsModel && !needsNotes}
          />
          {suggestions.length > 0 && !needsModel ? (
            <>
              <Text style={styles.label}>From your notes</Text>
              <ChipGroup>
                {suggestions.map((suggestion) => (
                  <Chip
                    key={suggestion.label}
                    label={suggestion.label}
                    icon="book-outline"
                    selected={request === suggestion.request}
                    onPress={() => setRequest(suggestion.request)}
                  />
                ))}
              </ChipGroup>
            </>
          ) : null}
          <Button title="Start planning" onPress={start} disabled={!canStart} />
        </Card>

        {needsModel ? (
          <Callout
            tone="warning"
            title="Needs a real model"
            message="The quiz builder plans with an AI model, and the offline generator can't follow a plan. Pick a provider and add its key in Settings."
          >
            <Button title="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
          </Callout>
        ) : null}

        {needsNotes ? (
          <Callout
            tone="info"
            title="Connect your notes first"
            message="Plans are built from your own notes. Connect a GitHub repository holding your markdown to get started."
          >
            <Button title="Add a source" variant="secondary" onPress={() => router.push('/sources/new')} />
          </Callout>
        ) : null}

        {plans.length > 0 ? (
          <View style={styles.list}>
            <SectionHeader title={`Your plans · ${plans.length}`} accent="violet" />
            {plans.map((plan) => (
              <PlanRow key={plan.id} plan={plan} />
            ))}
          </View>
        ) : (
          <View style={styles.list}>
            <SectionHeader title="How it works" accent="violet" />
            {STEPS.map((step, index) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.hint}>{step.body}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  label: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  list: { gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.violetSurface,
  },
  stepNumberText: { ...type.smallStrong, color: colors.violet },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { ...type.bodyStrong, fontSize: 15, color: colors.text },
}));
