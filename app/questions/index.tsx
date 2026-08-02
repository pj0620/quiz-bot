import { useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { listQuestionFormats, summarizeQuestion } from '../../src/quiz/questionTypes';
import { formatTopic } from '../../src/quiz/topics';
import { masteryOf } from '../../src/quiz/srs/mastery';
import { useQuestions, useReviewStates, useTopicVocabulary } from '../../src/quiz/useQuiz';
import type { Question, QuestionFormat } from '../../src/quiz/types';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ListRow } from '../../src/ui/components/ListRow';
import { MasteryDot } from '../../src/ui/components/MasteryDot';
import { TextField } from '../../src/ui/components/TextField';
import { colors, spacing } from '../../src/ui/theme';

/** Fixed row height lets FlatList skip measurement on a large bank. */
const ROW_HEIGHT = 76;

export default function QuestionBankScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ topic?: string }>();
  const questions = useQuestions();
  const reviewStates = useReviewStates();
  const vocabulary = useTopicVocabulary();

  const [search, setSearch] = useState('');
  // Seeded from the deep link, so Today's topic rows land pre-filtered.
  const [topic, setTopic] = useState<string | undefined>(
    typeof params.topic === 'string' ? params.topic : undefined,
  );
  const [format, setFormat] = useState<QuestionFormat | undefined>(undefined);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return questions.filter((question) => {
      if (flaggedOnly && !question.flagged) return false;
      if (topic && !question.topics.includes(topic)) return false;
      if (format && question.format !== format) return false;
      if (needle && !question.prompt.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [questions, search, topic, format, flaggedOnly]);

  const renderItem = ({ item }: { item: Question }) => {
    const level = masteryOf(reviewStates[item.id]);
    return (
      <ListRow
        title={item.prompt}
        subtitle={`${summarizeQuestion(item)} · ${item.topics.map(formatTopic).join(', ') || 'no topic'}${
          item.flagged ? ' · reported' : ''
        }`}
        onPress={() => router.push(`/questions/${encodeURIComponent(item.id)}`)}
        accessory={<MasteryDot level={level} />}
        showChevron
      />
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Question bank' }} />
      {/*
        The one screen that genuinely needs virtualization — a `.map()` inside a
        ScrollView (the convention everywhere else) will not hold thousands of
        rows. Deliberate departure.
      */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        getItemLayout={(_data, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        ListHeaderComponent={
          <View style={styles.filters}>
            <TextField placeholder="Search questions" value={search} onChangeText={setSearch} clearButtonMode="while-editing" />

            {vocabulary.length > 0 ? (
              <ChipGroup scroll>
                <Chip label="All topics" selected={!topic} onPress={() => setTopic(undefined)} />
                {vocabulary.map(({ topic: name, count }) => (
                  <Chip
                    key={name}
                    label={formatTopic(name)}
                    count={count}
                    selected={topic === name}
                    onPress={() => setTopic(topic === name ? undefined : name)}
                  />
                ))}
              </ChipGroup>
            ) : null}

            <ChipGroup scroll>
              <Chip label="All formats" selected={!format} onPress={() => setFormat(undefined)} />
              {listQuestionFormats().map((logic) => (
                <Chip
                  key={logic.format}
                  label={logic.label}
                  selected={format === logic.format}
                  onPress={() => setFormat(format === logic.format ? undefined : logic.format)}
                />
              ))}
              <Chip label="Reported" selected={flaggedOnly} onPress={() => setFlaggedOnly(!flaggedOnly)} />
            </ChipGroup>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No questions match"
            body="Try clearing a filter."
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  filters: { gap: spacing.sm, marginBottom: spacing.sm },
});
