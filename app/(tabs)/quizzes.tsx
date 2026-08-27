import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { describeRule } from '../../src/quiz/selection/describeRule';
import { describeAvailability } from '../../src/quiz/selection/select';
import { useQuizzes, useReviewStates, useSelectableQuestions } from '../../src/quiz/useQuiz';
import type { Quiz } from '../../src/quiz/types';
import { getSources } from '../../src/sources/store';
import { Badge } from '../../src/ui/components/Badge';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { HeaderIconButton } from '../../src/ui/components/HeaderIconButton';
import { ListRow } from '../../src/ui/components/ListRow';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { spacing } from '../../src/ui/theme';

export default function QuizzesScreen() {
  const router = useRouter();
  const quizzes = useQuizzes();
  // Bank plus enabled geography — see `useSelectableQuestions`.
  const questions = useSelectableQuestions();
  const reviewStates = useReviewStates();
  const now = Date.now();

  const sourceNames = useMemo(
    () => Object.fromEntries(getSources().map((source) => [source.id, source.fullName])),
    [],
  );

  const renderQuiz = useCallback(
    (quiz: Quiz) => {
      const availability = describeAvailability({ bank: questions, reviewStates, rule: quiz.rule, now });
      const hasNothing = availability.matching === 0;

      return (
        <ListRow
          key={quiz.id}
          title={quiz.name}
          subtitle={describeRule(quiz.rule, sourceNames)}
          icon={quiz.icon as never}
          onPress={() => router.push(`/quiz/${encodeURIComponent(quiz.id)}`)}
          accessory={
            <Badge
              label={hasNothing ? 'empty' : `${availability.matching}`}
              tone={hasNothing ? 'warning' : availability.due > 0 ? 'primary' : 'neutral'}
            />
          }
          showChevron
        />
      );
    },
    [questions, reviewStates, now, sourceNames, router],
  );

  const builtins = quizzes.filter((quiz) => quiz.builtin);
  const custom = quizzes.filter((quiz) => !quiz.builtin);

  return (
    <>
      <Tabs.Screen
        options={{
          title: 'Quizzes',
          headerRight: () => (
            <HeaderIconButton
              name="add"
              accessibilityLabel="Create a quiz"
              onPress={() => router.push('/quiz/new')}
            />
          ),
        }}
      />
      <Screen>
        {questions.length === 0 ? (
          <EmptyState
            icon="albums-outline"
            title="No questions yet"
            body="Generate questions from a source, then your quizzes will have something to draw on."
            actionTitle="Go to Library"
            onAction={() => router.push('/library')}
          />
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Built in" />
          {builtins.map(renderQuiz)}
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionHeader
            title="Your quizzes"
            accessory={
              <Ionicons name="add-circle-outline" size={20} color="#58A6FF" onPress={() => router.push('/quiz/new')} />
            }
          />
          {custom.length === 0 ? (
            <EmptyState
              icon="add-circle-outline"
              title="No custom quizzes"
              body="Create one focused on a topic you want to drill."
              actionTitle="Create a quiz"
              onAction={() => router.push('/quiz/new')}
            />
          ) : (
            custom.map(renderQuiz)
          )}
        </View>
      </Screen>
    </>
  );
}
