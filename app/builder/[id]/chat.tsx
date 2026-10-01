import { useCallback, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../src/lib/errors';
import { acceptAndWrite, acceptPlan } from '../../../src/quiz/builder/actions';
import { diffSpecs } from '../../../src/quiz/builder/planSpec';
import { runPlannerFor, sendPlannerMessage } from '../../../src/quiz/builder/planner';
import {
  hasKeptBatch,
  hasUnacceptedChanges,
  MAX_MESSAGE_CHARS,
  openBatch,
  type PlanMessage,
} from '../../../src/quiz/builder/types';
import { usePlan, usePlannerTurn, usePlanRun, useScopeNotes } from '../../../src/quiz/builder/useBuilder';
import { Button } from '../../../src/ui/components/Button';
import { Card } from '../../../src/ui/components/Card';
import { ChatBubble, ThinkingBubble } from '../../../src/ui/components/ChatBubble';
import { Chip, ChipGroup } from '../../../src/ui/components/Chip';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../../src/ui/components/ErrorBanner';
import { HeaderIconButton } from '../../../src/ui/components/HeaderIconButton';
import { PlanSpecView } from '../../../src/ui/components/PlanSpecView';
import { Screen } from '../../../src/ui/components/Screen';
import { TextField } from '../../../src/ui/components/TextField';
import { colors, radius, spacing, themedSheet, type } from '../../../src/ui/theme';

/**
 * Agreeing a plan with the model.
 *
 * A conversation with the plan itself always at the end of it: the reader
 * reads the planner's reply, then the plan it produced, right below — the
 * reply says what changed, the card says what it now is. Accepting is pinned
 * above the composer so it is never a scroll away once the plan is right.
 */

/** One-tap replies for the commonest changes — typing on a phone is the slow part. */
const QUICK_REPLIES = [
  'Make it harder',
  'Make it easier',
  'Fewer questions per note',
  'Only multiple choice',
  'Focus on the big ideas',
];

export default function PlanChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const planId = typeof params.id === 'string' ? params.id : undefined;
  const plan = usePlan(planId);
  const turn = usePlannerTurn(planId);
  const run = usePlanRun();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<PlanMessage>>(null);

  const [text, setText] = useState('');
  const [planOpen, setPlanOpen] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const working = plan?.spec ?? null;
  const matched = useScopeNotes(working);
  const thinking = !!turn?.thinking;

  const changes = useMemo(
    () => (plan?.accepted && working ? diffSpecs(plan.accepted, working) : []),
    [plan?.accepted, working],
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    (message: string) => {
      if (!planId || !message.trim() || thinking) return;
      setText('');
      void sendPlannerMessage(planId, message);
      scrollToEnd();
    },
    [planId, thinking, scrollToEnd],
  );

  const accept = useCallback(
    async (write: boolean) => {
      if (!planId) return;
      setError(null);
      setStarting(true);
      try {
        if (!write) {
          await acceptPlan(planId);
          // Back to the plan if the chat was opened from it, rather than a second copy on top.
          router.dismissTo(`/builder/${encodeURIComponent(planId)}`);
          return;
        }
        const outcome = await acceptAndWrite(planId);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        router.push(`/builder/${encodeURIComponent(planId)}/review/${encodeURIComponent(outcome.batchId)}`);
      } finally {
        setStarting(false);
      }
    },
    [planId, router],
  );

  if (!plan || !planId) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title="Plan not found" actionTitle="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  const unaccepted = hasUnacceptedChanges(plan);
  const busyElsewhere = !!openBatch(plan) || (run.job !== null);
  const kept = hasKeptBatch(plan);
  const notConfigured = !!turn?.error && toAppError(turn.error).code === 'llm_not_configured';

  const footer = (
    <View style={styles.footerItems}>
      {thinking ? <ThinkingBubble /> : null}

      {turn?.error && !thinking ? (
        <ErrorBanner error={turn.error} onRetry={() => void runPlannerFor(planId)} />
      ) : null}
      {notConfigured ? (
        <Button title="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
      ) : null}

      {working ? (
        <Card
          title={unaccepted ? (plan.accepted ? 'Proposed changes' : 'The plan so far') : 'The plan'}
          icon="document-text-outline"
          accent="violet"
          titleAccessory={
            <Pressable accessibilityRole="button" onPress={() => setPlanOpen((open) => !open)} hitSlop={8}>
              <Text style={styles.link}>{planOpen ? 'Less' : 'Full plan'}</Text>
            </Pressable>
          }
        >
          <PlanSpecView spec={working} noteCount={matched.length} full={planOpen} pending={unaccepted} />
          {unaccepted && changes.length > 0 ? (
            <View style={styles.changes}>
              <Text style={styles.label}>Since v{plan.accepted?.version}</Text>
              {changes.map((line) => (
                <Text key={line} style={styles.change}>
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {error ? <ErrorBanner error={error} /> : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Plan with AI',
          headerRight: plan.accepted
            ? () => (
                <HeaderIconButton
                  name="albums-outline"
                  accessibilityLabel="Open the plan"
                  onPress={() => router.push(`/builder/${encodeURIComponent(planId)}`)}
                />
              )
            : undefined,
        }}
      />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The view sits below the header, and the keyboard is measured from the
        // top of the window — without this the composer hides behind it.
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          ref={listRef}
          data={plan.messages}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => (
            <ChatBubble
              message={item}
              onShowPlan={() => {
                setPlanOpen(true);
                scrollToEnd();
              }}
            />
          )}
          style={styles.list}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListFooterComponent={footer}
          onContentSizeChange={scrollToEnd}
        />

        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {working && unaccepted && !thinking ? (
            busyElsewhere ? (
              <Button title={`Accept plan v${working.version}`} onPress={() => void accept(false)} loading={starting} />
            ) : (
              <View style={styles.acceptRow}>
                <Button
                  title={
                    !plan.accepted || !kept
                      ? plan.accepted
                        ? `Accept v${working.version} & try new samples`
                        : 'Accept plan & try 5 samples'
                      : `Accept v${working.version} & write ${plan.settings.batchSize} more`
                  }
                  onPress={() => void accept(true)}
                  loading={starting}
                  style={styles.grow}
                />
                {plan.accepted ? (
                  <Button title="Just accept" variant="plain" onPress={() => void accept(false)} disabled={starting} />
                ) : null}
              </View>
            )
          ) : null}

          {working && !thinking ? (
            <ChipGroup scroll>
              {QUICK_REPLIES.map((reply) => (
                <Chip key={reply} label={reply} onPress={() => send(reply)} />
              ))}
            </ChipGroup>
          ) : null}

          <View style={styles.composer}>
            <View style={styles.grow}>
              <TextField
                value={text}
                onChangeText={setText}
                placeholder={working ? 'Ask for a change…' : 'Tell it more about the quiz…'}
                maxLength={MAX_MESSAGE_CHARS}
                autoCapitalize="sentences"
                autoCorrect
                multiline
                size="compact"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: thinking || !text.trim() }}
              onPress={() => send(text)}
              disabled={thinking || !text.trim()}
              style={({ pressed }) => [
                styles.send,
                (thinking || !text.trim()) && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-up" size={20} color={colors.primaryText} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = themedSheet(() => ({
  fill: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  footerItems: { gap: spacing.md, marginTop: spacing.md },
  link: { ...type.smallStrong, color: colors.primary },
  label: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  changes: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  change: { ...type.small, color: colors.text },
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  acceptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  send: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
}));
