import { useCallback, useMemo } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { formatInterval } from '../../../src/lib/day';
import { summarizeQuestion } from '../../../src/quiz/questionTypes';
import { useQuestions, useReviewStates, useSession } from '../../../src/quiz/useQuiz';
import { sessionScore } from '../../../src/quiz/types';
import { Button } from '../../../src/ui/components/Button';
import { Card } from '../../../src/ui/components/Card';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { ListRow } from '../../../src/ui/components/ListRow';
import { ProgressBar } from '../../../src/ui/components/ProgressBar';
import { Screen } from '../../../src/ui/components/Screen';
import { SectionHeader } from '../../../src/ui/components/SectionHeader';
import { StatRow } from '../../../src/ui/components/StatRow';
import { colors, spacing, type } from '../../../src/ui/theme';

const OUTCOME_COLORS = {
  correct: colors.success,
  partial: colors.warning,
  incorrect: colors.danger,
} as const;

export default function ResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const session = useSession(typeof params.id === 'string' ? params.id : undefined);
  const questions = useQuestions();
  const reviewStates = useReviewStates();

  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );

  const stats = useMemo(() => {
    if (!session) return null;
    const { correct, total } = sessionScore(session);
    let partial = 0;
    let incorrect = 0;
    let newCount = 0;
    for (const item of session.items) {
      if (item.outcome === 'partial') partial += 1;
      if (item.outcome === 'incorrect') incorrect += 1;
      if (item.wasNew) newCount += 1;
    }
    return { correct, total, partial, incorrect, newCount };
  }, [session]);

  const missedIds = useMemo(
    () =>
      session?.items
        .filter((item) => item.outcome === 'incorrect' || item.outcome === 'partial')
        .map((item) => item.questionId) ?? [],
    [session],
  );

  const done = useCallback(() => {
    router.dismissAll();
  }, [router]);

  if (!session || !stats) {
    return (
      <Screen>
        <EmptyState
          icon="help-circle-outline"
          title="Results not found"
          actionTitle="Back"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const ratio = stats.total === 0 ? 0 : stats.correct / stats.total;
  const verdict =
    ratio === 1 ? 'Perfect run.' : ratio >= 0.7 ? 'Solid work.' : ratio >= 0.4 ? 'Getting there.' : 'Worth another pass.';

  return (
    <>
      <Stack.Screen options={{ title: 'Results', headerBackVisible: false }} />
      <Screen>
        <Card>
          <Text style={styles.score}>
            {stats.correct} / {stats.total}
          </Text>
          <ProgressBar value={ratio} height={10} />
          <Text style={styles.verdict}>{verdict}</Text>

          {/*
            The honest label. With a live rule the question set differs between
            attempts, so a bare score is not comparable — saying how many were
            new gives the number the context it needs.
          */}
          {stats.newCount > 0 ? (
            <Text style={styles.caveat}>
              {stats.newCount} of these {stats.newCount === 1 ? 'was' : 'were'} new to you
            </Text>
          ) : null}
        </Card>

        <StatRow
          stats={[
            { label: 'Correct', value: stats.correct, tone: 'success' },
            { label: 'Partial', value: stats.partial, tone: 'warning' },
            { label: 'Missed', value: stats.incorrect, tone: 'danger' },
          ]}
        />

        <SectionHeader title="What moved" />
        {session.items.map((item) => {
          const question = questionById.get(item.questionId);
          if (!question) return null;
          const state = reviewStates[item.questionId];
          const next = state ? `next in ${formatInterval(state.intervalDays)}` : 'not scheduled';

          return (
            <ListRow
              key={item.questionId}
              title={question.prompt}
              subtitle={`${summarizeQuestion(question)} · ${item.flagged ? 'reported' : next}`}
              onPress={() => router.push(`/questions/${encodeURIComponent(item.questionId)}`)}
              accessory={
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: item.outcome ? OUTCOME_COLORS[item.outcome] : colors.textFaint },
                  ]}
                />
              }
              showChevron
            />
          );
        })}

        {missedIds.length > 0 ? (
          <Button
            title={`Review the ${missedIds.length} you missed`}
            variant="secondary"
            onPress={() =>
              router.replace({
                pathname: '/session/start',
                params: { questionIds: missedIds.join(','), name: 'Review misses' },
              })
            }
          />
        ) : null}
        <Button title="Done" onPress={done} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  score: { ...type.title, color: colors.text, textAlign: 'center' },
  verdict: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  caveat: { ...type.small, color: colors.textFaint, textAlign: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
