import { useMemo } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { isCalendarQuestion } from '../../../src/quiz/calendar/catalog';
import { isGeographyQuestion } from '../../../src/quiz/geography/catalog';
import { computeTopicStats } from '../../../src/quiz/topicStats';
import { formatTopic } from '../../../src/quiz/topics';
import {
  useQuestions,
  useReviewStates,
  useSelectableQuestions,
  useSessions,
} from '../../../src/quiz/useQuiz';
import { Button } from '../../../src/ui/components/Button';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { ListRow } from '../../../src/ui/components/ListRow';
import { Screen } from '../../../src/ui/components/Screen';
import { SectionHeader } from '../../../src/ui/components/SectionHeader';
import { StatRow } from '../../../src/ui/components/StatRow';
import { ActivityCard, MasteryCard, ScoreCard } from '../../../src/ui/components/StatsCards';
import { spacing, themedSheet } from '../../../src/ui/theme';

/**
 * The Stats tab, for one topic.
 *
 * The same cards in the same order, computed over the topic's questions and
 * only the answers given to them — so a figure here means exactly what the
 * same figure means on the tab, just scoped. See `computeTopicStats`.
 */
export default function TopicStatsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ topic: string }>();
  const topic = typeof params.topic === 'string' ? params.topic : '';

  /*
    Bank plus enabled geography and calendar — see `useSelectableQuestions`.
    Progress on a derived topic like Europe lives in review state exactly as
    note progress does, and a bank-only view would show it as nothing at all.
  */
  const questions = useSelectableQuestions();
  const bank = useQuestions();
  const reviewStates = useReviewStates();
  const sessions = useSessions();
  const now = Date.now();

  const stats = useMemo(
    () => computeTopicStats({ questions, reviewStates, sessions, now, topic }),
    [questions, reviewStates, sessions, now, topic],
  );

  /**
   * How many of the topic's questions the bank browser can show.
   *
   * Derived questions are never in the bank, so for a geography or calendar
   * topic the browse button would open an empty list. Counted from the bank
   * rather than assumed from the topic's name, because a note is free to
   * carry the topic `geography` too.
   */
  const browsable = useMemo(
    () => bank.reduce((count, question) => count + (question.topics.includes(topic) ? 1 : 0), 0),
    [bank, topic],
  );

  /*
    Derived rows do not open the question screen, for the reason the results
    screen gives: that screen reads the bank, and there is no bank row to
    find. A row that goes nowhere beats one that lands on "Question not found".
  */
  const derived = useMemo(
    () =>
      new Set(
        questions
          .filter((question) => isGeographyQuestion(question) || isCalendarQuestion(question))
          .map((question) => question.id),
      ),
    [questions],
  );

  if (!topic || stats.bankTotal === 0) {
    return (
      <>
        <Stack.Screen options={{ title: topic ? formatTopic(topic) : 'Topic' }} />
        <Screen>
          <EmptyState
            icon="help-circle-outline"
            title="Nothing here any more"
            body="No question carries this topic now."
            actionTitle="Back"
            onAction={() => router.back()}
          />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: formatTopic(topic) }} />
      <Screen>
        <StatRow
          stats={[
            { label: 'Answered', value: stats.answered },
            {
              label: 'Accuracy',
              // Null rather than 0 when nothing has been answered, as on the
              // tab: "0%" reads as failure where the truth is "no data yet".
              value: stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)}%`,
              tone: stats.accuracy === null ? 'muted' : 'default',
            },
            /*
              Due rather than the tab's day streak. A streak of days spent on
              one topic is a true number nobody is chasing, whereas what is
              waiting in this topic is the thing to do next.
            */
            {
              label: 'Due now',
              value: stats.dueNow,
              tone: stats.dueNow > 0 ? 'success' : 'muted',
            },
          ]}
        />

        <MasteryCard stats={stats} />

        <ActivityCard stats={stats} now={now} />

        <ScoreCard stats={stats} now={now} showDue={false} />

        {stats.hardest.length > 0 ? (
          <>
            <SectionHeader title="Keeps catching you out" accent="amber" />
            {stats.hardest.map((entry) => {
              const openable = !derived.has(entry.questionId);
              return (
                <ListRow
                  key={entry.questionId}
                  title={entry.prompt}
                  subtitle={`Missed ${entry.lapses} time${entry.lapses === 1 ? '' : 's'}${entry.leech ? ' · set aside' : ''}`}
                  onPress={
                    openable
                      ? () => router.push(`/questions/${encodeURIComponent(entry.questionId)}`)
                      : undefined
                  }
                  showChevron={openable}
                />
              );
            })}
          </>
        ) : null}

        {browsable > 0 ? (
          <Button
            title={`Browse ${browsable} question${browsable === 1 ? '' : 's'}`}
            variant="secondary"
            onPress={() => router.push({ pathname: '/questions', params: { topic } })}
            style={styles.browse}
          />
        ) : null}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  browse: { marginTop: spacing.sm },
}));
