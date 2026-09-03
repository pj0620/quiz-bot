import {
  useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

import { computeStats } from '../../src/quiz/stats';
import {
  useActiveSession,
  useQuestions,
  useReviewStates,
  useSessions,
  useTopicSummaries,
} from '../../src/quiz/useQuiz';
import { useSources } from '../../src/sources/useSources';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ListRow } from '../../src/ui/components/ListRow';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { StatRow } from '../../src/ui/components/StatRow';
import { ActivityCard, MasteryCard, ScoreCard } from '../../src/ui/components/StatsCards';
import { TopicRow } from '../../src/ui/components/TopicRow';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

/** How many of the weakest topics the tab previews before handing over to "By topic". */
const WEAKEST_SHOWN = 5;

export default function StatsScreen() {
  const router = useRouter();
  const sources = useSources();
  const questions = useQuestions();
  const reviewStates = useReviewStates();
  const sessions = useSessions();
  const activeSession = useActiveSession();

  const now = Date.now();
  const stats = useMemo(
    () => computeStats({ questions, reviewStates, sessions, now }),
    [questions, reviewStates, sessions, now],
  );

  // Weakest first — the order to act on. See `summarizeTopics`.
  const topics = useTopicSummaries(now);

  if (sources.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="link-outline"
          title="Nothing to measure yet"
          body="QuizBot builds quizzes from your own notes. Connect a GitHub repository holding your markdown to get started."
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
          body="Generate questions from your notes and your progress will show up here."
          actionTitle="Generate questions"
          onAction={() => router.push('/generate')}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {/*
        Recovery, not a second place to start a quiz. This is the landing tab,
        so a session left half-finished has to be reachable from it — otherwise
        it is only findable by remembering which quiz it belonged to.
      */}
      {activeSession ? (
        <Callout tone="info" title="You have a quiz in progress" message={activeSession.quizName}>
          <Button
            title="Resume"
            onPress={() => router.push(`/session/${encodeURIComponent(activeSession.id)}`)}
          />
        </Callout>
      ) : null}

      <StatRow
        stats={[
          { label: 'Answered', value: stats.answered },
          {
            label: 'Accuracy',
            // Null rather than 0 when nothing has been answered: "0%" reads as
            // failure where the truth is "no data yet".
            value: stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)}%`,
            tone: stats.accuracy === null ? 'muted' : 'default',
          },
          {
            label: stats.dayStreak === 1 ? 'Day streak' : 'Day streak',
            value: stats.dayStreak,
            tone: stats.dayStreak > 0 ? 'success' : 'muted',
          },
        ]}
      />

      {/*
        The whole-bank figure is the summary; the card itself is the way into
        the same picture per topic. A drill-down rather than a filter on this
        tab, because the tab is the landing screen and a filter left switched
        on would make every number on it describe one topic while looking
        like the whole.
      */}
      <MasteryCard
        stats={stats}
        titleAccessory={<Text style={styles.link}>By topic</Text>}
        onPress={() => router.push('/stats/topics')}
      />

      <ActivityCard stats={stats} now={now} />

      <ScoreCard stats={stats} now={now} />

      {topics.length > 0 ? (
        <>
          <SectionHeader
            title="Weakest topics"
            accent="danger"
            accessory={
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/stats/topics')}
                hitSlop={8}
                style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
              >
                <Text style={styles.link}>See all {topics.length}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </Pressable>
            }
          />
          {topics.slice(0, WEAKEST_SHOWN).map((topic) => (
            <TopicRow
              key={topic.topic}
              topic={topic}
              onPress={() => router.push(`/stats/topics/${encodeURIComponent(topic.topic)}`)}
            />
          ))}
        </>
      ) : null}

      {stats.hardest.length > 0 ? (
        <>
          {/* The most actionable list on the screen: these are the notes to
              go back and re-read, named by the question that keeps failing. */}
          <SectionHeader title="Keeps catching you out" accent="amber" />
          {stats.hardest.map((entry) => (
            <ListRow
              key={entry.questionId}
              title={entry.prompt}
              subtitle={`Missed ${entry.lapses} time${entry.lapses === 1 ? '' : 's'}${entry.leech ? ' · set aside' : ''}`}
              onPress={() => router.push(`/questions/${encodeURIComponent(entry.questionId)}`)}
              showChevron
            />
          ))}
        </>
      ) : null}

      {stats.recentSessions.length > 0 ? (
        <>
          <SectionHeader title="Recent quizzes" accent="teal" />
          {stats.recentSessions.slice(0, 5).map((entry) => (
            <ListRow
              key={entry.id}
              title={entry.quizName}
              subtitle={`${entry.correct} of ${entry.total}`}
              onPress={() => router.push(`/session/results/${encodeURIComponent(entry.id)}`)}
              accessory={
                <Text style={styles.score}>{Math.round((entry.correct / entry.total) * 100)}%</Text>
              }
              showChevron
            />
          ))}
          {/*
            Said once, plainly. Quizzes draw from a live rule, so two attempts
            are rarely the same questions and comparing their scores directly
            would mislead. Mastery above is the number that is comparable.
          */}
          <Text style={styles.hint}>
            Scores aren't comparable between attempts — each quiz draws a fresh
            set from your bank.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = themedSheet(() => ({
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  link: { ...type.smallStrong, color: colors.primary },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pressed: { opacity: 0.6 },
  score: { ...type.bodyStrong, color: colors.textMuted },
}));
