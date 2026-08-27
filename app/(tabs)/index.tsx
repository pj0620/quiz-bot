import {
  useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { addDays } from '../../src/lib/day';
import { formatTopic } from '../../src/quiz/topics';
import { MASTERY_LABELS } from '../../src/quiz/srs/mastery';
import { computeStats, overallMastery } from '../../src/quiz/stats';
import {
  useActiveSession,
  useQuestions,
  useReviewStates,
  useSessions,
  useTopicMastery,
} from '../../src/quiz/useQuiz';
import { useSources } from '../../src/sources/useSources';
import { BarChart } from '../../src/ui/components/BarChart';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ListRow } from '../../src/ui/components/ListRow';
import { MasteryDot, MASTERY_COLORS } from '../../src/ui/components/MasteryDot';
import { GradePill } from '../../src/ui/components/GradePill';
import { ProgressBar } from '../../src/ui/components/ProgressBar';
import { Screen } from '../../src/ui/components/Screen';
import { ScoreDots } from '../../src/ui/components/ScoreDots';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { SegmentedBar } from '../../src/ui/components/SegmentedBar';
import { StatRow } from '../../src/ui/components/StatRow';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function weekdayLabel(now: number, dayOffset: number): string {
  return WEEKDAY[new Date(addDays(now, dayOffset)).getDay()];
}

export default function StatsScreen() {
  const router = useRouter();
  const sources = useSources();
  const questions = useQuestions();
  const reviewStates = useReviewStates();
  const sessions = useSessions();
  const activeSession = useActiveSession();
  const topics = useTopicMastery();

  const now = Date.now();
  const stats = useMemo(
    () => computeStats({ questions, reviewStates, sessions, now }),
    [questions, reviewStates, sessions, now],
  );

  const mastered = useMemo(() => overallMastery(stats.mastery), [stats.mastery]);

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

      <Card title="What you know" icon="school-outline" accent="violet">
        <View style={styles.masteryHead}>
          <Text style={styles.big}>{Math.round(mastered * 100)}%</Text>
          <Text style={styles.hint}>
            across {stats.bankTotal} question{stats.bankTotal === 1 ? '' : 's'}
          </Text>
        </View>
        <ProgressBar value={mastered} height={8} />
        <SegmentedBar
          segments={stats.mastery.map((slice) => ({
            label: MASTERY_LABELS[slice.level],
            value: slice.count,
            color: MASTERY_COLORS[slice.level],
          }))}
        />
      </Card>

      <Card title="Reviews, last 14 days" icon="bar-chart-outline" accent="teal">
        <BarChart
          bars={stats.activity.map((day) => ({
            value: day.reviewed,
            label: weekdayLabel(now, day.dayOffset),
            highlight: day.dayOffset === 0,
          }))}
          maxLabel={`peak ${Math.max(...stats.activity.map((day) => day.reviewed), 0)}`}
          emptyMessage="No reviews in the last two weeks"
        />
        <Text style={styles.hint}>
          {stats.reviewedToday > 0
            ? `${stats.reviewedToday} answered today`
            : 'Nothing answered today yet'}
        </Text>
      </Card>

      <Card title="How you scored" icon="ribbon-outline" accent="amber">
        <ScoreDots
          days={stats.week.map((day) => ({
            label: weekdayLabel(now, day.dayOffset),
            score: day.score,
            grade: day.grade,
            highlight: day.dayOffset === 0,
          }))}
        />
        <Text style={styles.hint}>
          Percent correct each day. Grey means you didn&rsquo;t study that day.
        </Text>
        {stats.dueNow > 0 ? (
          <Text style={styles.hint}>{stats.dueNow} ready to review now</Text>
        ) : null}
      </Card>

      {topics.length > 0 ? (
        <>
          <SectionHeader
            title="Weakest topics"
            accent="danger"
            accessory={<Text style={styles.count}>{topics.length}</Text>}
          />
          {topics.slice(0, 5).map((topic) => {
            const scored = stats.topicScores[topic.topic];
            return (
              <ListRow
                key={topic.topic}
                title={formatTopic(topic.topic)}
                /*
                  Mastery and answer count, with the grade shown separately.
                  They answer different questions — "how well does the schedule
                  think you know this" versus "how well have you actually
                  answered it" — and collapsing them would hide the case that
                  matters: a topic graded A that is still mostly unseen.
                */
                subtitle={`${MASTERY_LABELS[topic.level]} · ${topic.total} question${topic.total === 1 ? '' : 's'}${
                  scored ? ` · ${scored.correct}/${scored.answered} right` : ''
                }`}
                onPress={() => router.push({ pathname: '/questions', params: { topic: topic.topic } })}
                accessory={
                  <View style={styles.topicCell}>
                    <GradePill grade={scored?.grade ?? null} score={scored?.score ?? null} />
                    <View style={styles.masteryCell}>
                      <ProgressBar value={topic.score} height={4} />
                      <MasteryDot level={topic.level} size={7} />
                    </View>
                  </View>
                }
              />
            );
          })}
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
  masteryHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  big: { ...type.title, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  count: { ...type.small, color: colors.textFaint },
  topicCell: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  masteryCell: { width: 44, gap: spacing.xs, alignItems: 'center' },
  score: { ...type.bodyStrong, color: colors.textMuted },
}));
