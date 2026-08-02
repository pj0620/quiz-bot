import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { formatTopic } from '../../src/quiz/topics';
import { describeAvailability } from '../../src/quiz/selection/select';
import { MASTERY_LABELS } from '../../src/quiz/srs/mastery';
import { startQuizSession } from '../../src/quiz/startSession';
import {
  useActiveSession,
  useBankSummary,
  useQuizzes,
  useQuestions,
  useTopicMastery,
} from '../../src/quiz/useQuiz';
import { useSources } from '../../src/sources/useSources';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ListRow } from '../../src/ui/components/ListRow';
import { MasteryDot } from '../../src/ui/components/MasteryDot';
import { ProgressBar } from '../../src/ui/components/ProgressBar';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { StatRow } from '../../src/ui/components/StatRow';
import { colors, spacing, type } from '../../src/ui/theme';

export default function TodayScreen() {
  const router = useRouter();
  const sources = useSources();
  const questions = useQuestions();
  const quizzes = useQuizzes();
  const activeSession = useActiveSession();
  const topics = useTopicMastery();
  const now = Date.now();
  const summary = useBankSummary(now);

  const daily = useMemo(() => quizzes.find((quiz) => quiz.id === 'builtin:daily'), [quizzes]);

  const dailyAvailability = useMemo(
    () =>
      daily
        ? describeAvailability({ bank: questions, reviewStates: {}, rule: daily.rule, now })
        : null,
    [daily, questions, now],
  );

  const startDaily = useCallback(() => {
    if (!daily) return;
    const result = startQuizSession(daily);
    if (!result) {
      Alert.alert('Nothing due', 'No questions match your daily quiz right now.');
      return;
    }
    router.push(`/session/${encodeURIComponent(result.session.id)}`);
  }, [daily, router]);

  // Today is the launch screen now, so a first-run user with no sources must be
  // routed straight into onboarding rather than left on an empty screen.
  if (sources.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="link-outline"
          title="Connect a source"
          body="QuizBot builds quizzes from your own notes. Connect a GitHub repository holding your markdown and it'll start asking you about what you've written."
          actionTitle="Connect GitHub"
          onAction={() => router.push('/sources/new')}
        />
      </Screen>
    );
  }

  if (questions.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="sparkles-outline"
          title="No questions yet"
          body="Generate questions from your connected sources and they'll show up here."
          actionTitle="Go to Library"
          onAction={() => router.push('/library')}
        />
      </Screen>
    );
  }

  const caughtUp = summary.due === 0 && summary.new === 0;

  return (
    <Screen>
      {activeSession ? (
        <Callout tone="info" title="You have a quiz in progress" message={activeSession.quizName}>
          <Button
            title="Resume"
            onPress={() => router.push(`/session/${encodeURIComponent(activeSession.id)}`)}
          />
        </Callout>
      ) : null}

      <Card title={daily?.name ?? 'Daily quiz'}>
        {caughtUp ? (
          /* The due===0 state is a designed state, not an empty screen — with a
             growing bank it's common for the first week. */
          <>
            <Text style={styles.caughtUp}>You're caught up.</Text>
            <Text style={styles.body}>Nothing is due. Practise anyway to get ahead.</Text>
          </>
        ) : (
          <Text style={styles.body}>
            {summary.due > 0 ? `${summary.due} due for review` : 'Nothing due'}
            {summary.new > 0 ? ` · ${summary.new} new` : ''}
          </Text>
        )}

        <StatRow
          stats={[
            { label: 'Due', value: summary.due, tone: summary.due > 0 ? 'success' : 'muted' },
            { label: 'New', value: summary.new, tone: 'muted' },
            { label: 'In bank', value: summary.total, tone: 'muted' },
          ]}
        />

        <Button
          title={
            dailyAvailability && dailyAvailability.matching > 0
              ? `Start · ${Math.min(daily?.rule.size ?? 10, dailyAvailability.matching)} questions`
              : 'Practise anyway'
          }
          onPress={startDaily}
        />
      </Card>

      {topics.length > 0 ? (
        <>
          <SectionHeader title="Your topics" accessory={<Text style={styles.count}>{topics.length}</Text>} />
          {topics.slice(0, 6).map((topic) => (
            <ListRow
              key={topic.topic}
              title={formatTopic(topic.topic)}
              subtitle={`${MASTERY_LABELS[topic.level]} · ${topic.total} question${topic.total === 1 ? '' : 's'}`}
              onPress={() => router.push({ pathname: '/questions', params: { topic: topic.topic } })}
              accessory={
                <View style={styles.masteryCell}>
                  <ProgressBar value={topic.score} height={6} />
                  <MasteryDot level={topic.level} />
                </View>
              }
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...type.body, color: colors.textMuted },
  caughtUp: { ...type.heading, color: colors.success },
  count: { ...type.small, color: colors.textFaint },
  masteryCell: { width: 60, gap: spacing.xs, alignItems: 'center' },
});
