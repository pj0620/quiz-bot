import {
  useCallback,
  useMemo } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import { Alert,
  Text,
  View,
} from 'react-native';

import { formatTopic } from '../../src/quiz/topics';
import { describeDraw, describeMix, describeRule } from '../../src/quiz/selection/describeRule';
import { describeAvailability } from '../../src/quiz/selection/select';
import { useSelectionMode } from '../../src/quiz/preferences';
import { masteryOf } from '../../src/quiz/srs/mastery';
import { startQuizSession } from '../../src/quiz/startSession';
import { removeQuiz } from '../../src/quiz/store';
import {
  useQuiz,
  useReviewStates,
  useSelectableQuestions,
  useSessions,
} from '../../src/quiz/useQuiz';
import { useEnabledCalendarSubjects } from '../../src/quiz/calendar/preferences';
import { CALENDAR_TOPIC } from '../../src/quiz/calendar/types';
import { useEnabledSubjects } from '../../src/quiz/geography/preferences';
import { GEOGRAPHY_TOPIC } from '../../src/quiz/geography/types';
import { matchesRule } from '../../src/quiz/selection/matchesRule';
import { MASTERY_ORDER } from '../../src/quiz/srs/mastery';
import { sessionScore } from '../../src/quiz/types';
import { getSources } from '../../src/sources/store';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ListRow } from '../../src/ui/components/ListRow';
import { ProgressBar } from '../../src/ui/components/ProgressBar';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { StatRow } from '../../src/ui/components/StatRow';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

export default function QuizDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const quiz = useQuiz(typeof params.id === 'string' ? params.id : undefined);
  // Bank plus enabled geography — see `useSelectableQuestions`.
  const questions = useSelectableQuestions();
  const reviewStates = useReviewStates();
  const sessions = useSessions();
  const now = Date.now();

  const sourceNames = useMemo(
    () => Object.fromEntries(getSources().map((source) => [source.id, source.fullName])),
    [],
  );

  const selectionMode = useSelectionMode();

  /*
    An empty quiz that only Settings can fill.

    True when the rule asks for geography and no subject is switched on — which
    is exactly the state a reader lands in after tapping the seeded built-in
    quiz for the first time, since subjects default to off.
  */
  const enabledSubjects = useEnabledSubjects();
  const needsGeographySubjects =
    enabledSubjects.length === 0 && !!quiz?.rule.topics?.includes(GEOGRAPHY_TOPIC);

  // The calendar twin of the same state: the built-in Calendar quiz is seeded
  // with every subject off, and only Settings can fill it.
  const enabledCalendarSubjects = useEnabledCalendarSubjects();
  const needsCalendarSubjects =
    enabledCalendarSubjects.length === 0 && !!quiz?.rule.topics?.includes(CALENDAR_TOPIC);

  const availability = useMemo(
    () => (quiz ? describeAvailability({ bank: questions, reviewStates, rule: quiz.rule, now }) : null),
    [quiz, questions, reviewStates, now],
  );

  /**
   * Mastery across the questions this rule matches.
   *
   * This is the hero metric rather than the last score, because with a live
   * rule the question set differs between attempts — mastery is comparable,
   * a score isn't.
   */
  const mastery = useMemo(() => {
    if (!quiz) return null;
    const matching = questions.filter((question) =>
      matchesRule(question, quiz.rule, reviewStates[question.id], now),
    );
    if (matching.length === 0) return null;

    const sum = matching.reduce(
      (total, question) => total + MASTERY_ORDER[masteryOf(reviewStates[question.id])],
      0,
    );
    return { score: sum / (matching.length * MASTERY_ORDER.solid), total: matching.length };
  }, [quiz, questions, reviewStates, now]);

  const history = useMemo(
    () =>
      sessions
        .filter((session) => session.quizId === quiz?.id && session.status === 'completed')
        .slice(0, 5),
    [sessions, quiz?.id],
  );

  const start = useCallback(() => {
    if (!quiz) return;
    const result = startQuizSession(quiz);
    if (!result) {
      Alert.alert('Nothing to draw on', 'No questions match this quiz right now.');
      return;
    }
    router.push(`/session/${encodeURIComponent(result.session.id)}`);
  }, [quiz, router]);

  const confirmDelete = useCallback(() => {
    if (!quiz) return;
    Alert.alert('Delete this quiz?', 'Your questions and progress are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeQuiz(quiz.id);
          router.back();
        },
      },
    ]);
  }, [quiz, router]);

  if (!quiz || !availability) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title="Quiz not found" actionTitle="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  const drawSize = Math.min(quiz.rule.size, availability.matching);

  return (
    <>
      <Stack.Screen options={{ title: quiz.name }} />
      <Screen>
        {/* Mastery is the hero, not the last score. */}
        {mastery ? (
          <Card title="Mastery">
            <ProgressBar value={mastery.score} height={10} />
            <Text style={styles.masteryLabel}>
              {Math.round(mastery.score * 100)}% across {mastery.total} question
              {mastery.total === 1 ? '' : 's'}
            </Text>
          </Card>
        ) : null}

        <Card>
          <Text style={styles.rule}>{describeRule(quiz.rule, sourceNames)}</Text>
          {/* States the liveness up front, so changing question sets never surprises. */}
          <Text style={styles.draw}>{describeDraw(quiz.rule, availability.matching)}</Text>

          <StatRow
            stats={[
              { label: 'New', value: availability.new, tone: 'muted' },
              { label: 'Due', value: availability.due, tone: availability.due > 0 ? 'success' : 'muted' },
              { label: 'Resting', value: availability.notYetDue, tone: 'muted' },
            ]}
          />

          {/*
            The breakdown above is a fact about the schedule either way, but
            "Resting" reads as "will not be asked" — which stops being true in
            even mode, where every matching question is eligible. Saying so here
            is cheaper than making the reader remember a setting.
          */}
          {selectionMode === 'even' ? (
            <Text style={styles.draw}>
              Even picking is on, so all {availability.matching} are equally likely — resting and
              difficult ones included. Change it in Settings.
            </Text>
          ) : null}

          {availability.matching === 0 ? (
            /*
              An empty geography quiz has a different cause and a different cure
              from an empty note quiz, so it gets its own advice. The generic
              line tells the reader to generate questions from their sources,
              which for geography is not merely unhelpful — it is impossible.
              Nothing is generated, and no source is involved; there is a switch
              in Settings and that is all.
            */
            <Callout
              tone="warning"
              message={
                needsGeographySubjects
                  ? 'This quiz asks about geography, but no subjects are switched on. Turn on US States, Europe or Continents in Settings and it will fill up straight away.'
                  : needsCalendarSubjects
                    ? 'This quiz asks about the calendar, but no subjects are switched on. Turn on Months, Days of the week, Seasons or Holiday dates in Settings and it will fill up straight away.'
                    : 'Nothing matches this quiz yet. Loosen the rule, or generate more questions from your sources.'
              }
            />
          ) : availability.matching < quiz.rule.size ? (
            <Callout
              tone="info"
              message={`Only ${availability.matching} questions match, so this run will be shorter than ${quiz.rule.size}.`}
            />
          ) : null}

          <Button
            title={availability.matching === 0 ? 'Nothing to start' : `Start · ${drawSize} questions`}
            onPress={start}
            disabled={availability.matching === 0}
          />
        </Card>

        <SectionHeader title="Rule" />
        <ChipGroup>
          <Chip label={describeMix(quiz.rule)} />
          <Chip label={`${quiz.rule.size} per run`} />
          {quiz.rule.topics?.map((topic) => <Chip key={topic} label={formatTopic(topic)} />)}
          {quiz.rule.addedWithinDays ? <Chip label={`last ${quiz.rule.addedWithinDays}d`} /> : null}
        </ChipGroup>

        {history.length > 0 ? (
          <>
            <SectionHeader title="Recent attempts" />
            {history.map((session) => {
              const score = sessionScore(session);
              const newCount = session.items.filter((item) => item.wasNew).length;
              return (
                <ListRow
                  key={session.id}
                  title={`${score.correct} of ${score.total}`}
                  subtitle={`${new Date(session.completedAt ?? session.startedAt).toLocaleDateString()} · ${newCount} new`}
                  onPress={() => router.push(`/session/results/${encodeURIComponent(session.id)}`)}
                  showChevron
                />
              );
            })}
          </>
        ) : null}

        <View style={styles.footer}>
          <Button
            title="Edit rule"
            variant="secondary"
            onPress={() => router.push(`/quiz/edit/${encodeURIComponent(quiz.id)}`)}
          />
          {!quiz.builtin ? <Button title="Delete quiz" variant="destructive" onPress={confirmDelete} /> : null}
        </View>
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  masteryLabel: { ...type.small, color: colors.textMuted },
  rule: { ...type.bodyStrong, color: colors.text },
  draw: { ...type.small, color: colors.textMuted },
  footer: { gap: spacing.sm, marginTop: spacing.md },
}));
