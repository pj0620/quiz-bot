import { useMemo, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { FlatList, Text, View } from 'react-native';

import {
  applyTopicFilter,
  emptyTopicFilter,
  TOPIC_SHOWS,
  TOPIC_SORTS,
  type TopicFilter,
  type TopicSummary,
} from '../../../src/quiz/topicStats';
import { useTopicSummaries } from '../../../src/quiz/useQuiz';
import { Chip, ChipGroup } from '../../../src/ui/components/Chip';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { SegmentedControl } from '../../../src/ui/components/SegmentedControl';
import { TextField } from '../../../src/ui/components/TextField';
import { TopicRow } from '../../../src/ui/components/TopicRow';
import { colors, spacing, themedSheet, type } from '../../../src/ui/theme';

/**
 * Every topic, with the controls the Stats tab's five-row preview leaves out.
 *
 * A screen of its own rather than a filter on the Stats tab. The filter was
 * the obvious alternative, so the reasons are worth recording:
 *
 *  - The tab is the landing screen. A filter left switched on would make
 *    "158 answered" describe one topic while looking like the whole.
 *  - The point of "by topic" is comparison, which a filter showing one topic
 *    at a time cannot give. A list can.
 *  - A vault's worth of notes produces more topics than a chip row can hold.
 *    The question bank moved its topic chips into a sheet for that reason.
 *
 * A FlatList rather than the `.map()` every other screen uses, for the bank
 * browser's reason: topics come three to a note, so a large vault produces
 * hundreds of rows.
 */
export default function TopicsScreen() {
  const router = useRouter();
  /*
    Pinned for the life of the screen rather than read on every render. The
    summaries are recomputed whenever the clock they were computed with
    changes, and a fresh `Date.now()` per keystroke in the search field would
    recompute every topic on every character typed.
  */
  const [now] = useState(() => Date.now());
  const topics = useTopicSummaries(now);
  const [filter, setFilter] = useState<TopicFilter>(emptyTopicFilter);

  const shown = useMemo(() => applyTopicFilter(topics, filter), [topics, filter]);
  const narrowed = filter.show !== 'all' || filter.search.trim().length > 0;

  const renderItem = ({ item }: { item: TopicSummary }) => (
    <TopicRow
      topic={item}
      onPress={() => router.push(`/stats/topics/${encodeURIComponent(item.topic)}`)}
    />
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'By topic' }} />
      <FlatList
        data={shown}
        keyExtractor={(item) => item.topic}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.controls}>
            <TextField
              placeholder="Search topics"
              value={filter.search}
              onChangeText={(search) => setFilter((current) => ({ ...current, search }))}
              clearButtonMode="while-editing"
            />

            <SegmentedControl
              options={TOPIC_SHOWS.map(({ show, label }) => ({ value: show, label }))}
              value={filter.show}
              onChange={(show) => setFilter((current) => ({ ...current, show }))}
            />

            <ChipGroup scroll>
              {TOPIC_SORTS.map(({ sort, label }) => (
                <Chip
                  key={sort}
                  label={label}
                  selected={filter.sort === sort}
                  onPress={() => setFilter((current) => ({ ...current, sort }))}
                />
              ))}
            </ChipGroup>

            {narrowed ? (
              <Text style={styles.countLine}>
                {shown.length} of {topics.length} topic{topics.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          topics.length === 0 ? (
            <EmptyState
              icon="school-outline"
              title="No topics yet"
              body="Generate questions from your notes and they will be grouped here by topic."
            />
          ) : (
            <EmptyState
              icon="search-outline"
              title="No topics match"
              body={
                filter.show === 'due'
                  ? 'Nothing is waiting for review right now.'
                  : 'Try clearing a filter.'
              }
            />
          )
        }
      />
    </View>
  );
}

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  controls: { gap: spacing.sm, marginBottom: spacing.sm },
  countLine: { ...type.small, color: colors.textMuted },
}));
