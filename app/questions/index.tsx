import { useCallback, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ADDED_WINDOWS,
  applyBankFilter,
  BANK_SORTS,
  countActiveFilters,
  emptyBankFilter,
  type BankFilter,
} from '../../src/quiz/bankFilter';
import { listQuestionFormats, summarizeQuestion } from '../../src/quiz/questionTypes';
import { formatTopic } from '../../src/quiz/topics';
import { MASTERY_LABELS, masteryOf } from '../../src/quiz/srs/mastery';
import { deleteQuestions } from '../../src/quiz/store';
import { useQuestions, useReviewStates, useTopicVocabulary } from '../../src/quiz/useQuiz';
import type { Difficulty, MasteryLevel, Question } from '../../src/quiz/types';
import { Button } from '../../src/ui/components/Button';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { HeaderIconButton } from '../../src/ui/components/HeaderIconButton';
import { ListRow } from '../../src/ui/components/ListRow';
import { MasteryDot } from '../../src/ui/components/MasteryDot';
import { TextField } from '../../src/ui/components/TextField';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

/*
  No `getItemLayout` here on purpose.

  It looks like free performance, but it requires every row to be exactly the
  height you promise, and `ListRow` wraps its subtitle to two lines — so a row
  with a long topic list is taller than one without. A wrong `getItemLayout`
  doesn't fail loudly; it silently corrupts scroll offsets. FlatList measures
  variable rows correctly on its own, and this screen never jumps to an index.
*/

const DIFFICULTIES: readonly { value: Difficulty; label: string }[] = [
  { value: 'intro', label: 'Intro' },
  { value: 'core', label: 'Core' },
  { value: 'deep', label: 'Deep' },
];

const MASTERY_LEVELS: readonly MasteryLevel[] = ['new', 'learning', 'shaky', 'familiar', 'solid'];

/** Toggle `value` in an any-of list. */
function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/**
 * The filter sheet: every dimension in one place, applied live.
 *
 * A modal rather than more chip rows on the screen, because rows stopped
 * scaling: every topic in the bank rendered as one horizontal scroller, and
 * each new dimension (this change alone adds dates, difficulty, mastery and
 * sort) would have stacked another. Filters apply as they are tapped, so the
 * Done button can say exactly how many rows the reader is returning to.
 */
function FilterSheet({
  visible,
  filter,
  onChange,
  onClose,
  matchCount,
}: {
  visible: boolean;
  filter: BankFilter;
  onChange: (next: BankFilter) => void;
  onClose: () => void;
  matchCount: number;
}) {
  const insets = useSafeAreaInsets();
  const vocabulary = useTopicVocabulary();
  const active = countActiveFilters(filter);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Filter & sort</Text>
          <HeaderIconButton name="close" accessibilityLabel="Close filters" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={styles.sheetLabel}>Sort</Text>
          <ChipGroup>
            {BANK_SORTS.map(({ sort, label }) => (
              <Chip
                key={sort}
                label={label}
                selected={filter.sort === sort}
                onPress={() => onChange({ ...filter, sort })}
              />
            ))}
          </ChipGroup>

          <Text style={styles.sheetLabel}>Added</Text>
          <ChipGroup>
            <Chip
              label="Any time"
              selected={filter.addedWithinDays === undefined}
              onPress={() => onChange({ ...filter, addedWithinDays: undefined })}
            />
            {ADDED_WINDOWS.map(({ days, label }) => (
              <Chip
                key={days}
                label={label}
                selected={filter.addedWithinDays === days}
                onPress={() =>
                  onChange({
                    ...filter,
                    addedWithinDays: filter.addedWithinDays === days ? undefined : days,
                  })
                }
              />
            ))}
          </ChipGroup>

          {vocabulary.length > 0 ? (
            <>
              <Text style={styles.sheetLabel}>Topics</Text>
              <ChipGroup>
                {vocabulary.map(({ topic, count }) => (
                  <Chip
                    key={topic}
                    label={formatTopic(topic)}
                    count={count}
                    selected={filter.topics.includes(topic)}
                    onPress={() => onChange({ ...filter, topics: toggled(filter.topics, topic) })}
                  />
                ))}
              </ChipGroup>
            </>
          ) : null}

          <Text style={styles.sheetLabel}>Format</Text>
          <ChipGroup>
            {listQuestionFormats().map((logic) => (
              <Chip
                key={logic.format}
                label={logic.label}
                selected={filter.formats.includes(logic.format)}
                onPress={() =>
                  onChange({ ...filter, formats: toggled(filter.formats, logic.format) })
                }
              />
            ))}
          </ChipGroup>

          <Text style={styles.sheetLabel}>Difficulty</Text>
          <ChipGroup>
            {DIFFICULTIES.map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                selected={filter.difficulties.includes(value)}
                onPress={() =>
                  onChange({ ...filter, difficulties: toggled(filter.difficulties, value) })
                }
              />
            ))}
          </ChipGroup>

          <Text style={styles.sheetLabel}>Mastery</Text>
          <ChipGroup>
            {MASTERY_LEVELS.map((level) => (
              <Chip
                key={level}
                label={MASTERY_LABELS[level]}
                selected={filter.mastery.includes(level)}
                onPress={() => onChange({ ...filter, mastery: toggled(filter.mastery, level) })}
              />
            ))}
          </ChipGroup>

          <Text style={styles.sheetLabel}>Other</Text>
          <ChipGroup>
            <Chip
              label="Reported only"
              selected={filter.flaggedOnly}
              onPress={() => onChange({ ...filter, flaggedOnly: !filter.flaggedOnly })}
            />
          </ChipGroup>
        </ScrollView>

        <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + spacing.md }]}>
          {active > 0 ? (
            <Button
              title="Reset filters"
              variant="plain"
              onPress={() =>
                // Search stays: its field is visible on the screen behind, and
                // wiping typed text from a "reset filters" button reads as a bug.
                onChange({ ...emptyBankFilter(), search: filter.search, sort: filter.sort })
              }
            />
          ) : null}
          <Button
            title={`Show ${matchCount} question${matchCount === 1 ? '' : 's'}`}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

export default function QuestionBankScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ topic?: string }>();
  const questions = useQuestions();
  const reviewStates = useReviewStates();

  // Seeded from the deep link, so Today's topic rows land pre-filtered.
  const [filter, setFilter] = useState<BankFilter>(() => ({
    ...emptyBankFilter(),
    topics: typeof params.topic === 'string' ? [params.topic] : [],
  }));
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * Selection mode, and what is selected.
   *
   * Held as ids rather than questions so a selection survives the list
   * re-rendering underneath it — which it does constantly here, since the
   * filters above are live.
   */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Height of the delete bar, measured rather than assumed.
   *
   * It has to become padding under the list or the bar sits on top of the last
   * row — and its height moves with the safe area and with whether the
   * "selected outside this view" line is showing, so a constant would be wrong
   * on exactly the devices nobody tests on.
   */
  const [barHeight, setBarHeight] = useState(0);

  const filtered = useMemo(
    () => applyBankFilter(questions, filter, reviewStates, Date.now()),
    [questions, filter, reviewStates],
  );

  const activeCount = countActiveFilters(filter);

  /**
   * The active constraints, echoed as removable chips beside the Filters
   * button — so what is narrowing the list stays visible without opening the
   * sheet, and is one tap wide of where it was set.
   */
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; remove: (current: BankFilter) => BankFilter }[] = [];
    for (const topic of filter.topics) {
      chips.push({
        key: `topic:${topic}`,
        label: formatTopic(topic),
        remove: (current) => ({ ...current, topics: current.topics.filter((t) => t !== topic) }),
      });
    }
    for (const format of filter.formats) {
      chips.push({
        key: `format:${format}`,
        label: listQuestionFormats().find((logic) => logic.format === format)?.label ?? format,
        remove: (current) => ({ ...current, formats: current.formats.filter((f) => f !== format) }),
      });
    }
    for (const difficulty of filter.difficulties) {
      chips.push({
        key: `difficulty:${difficulty}`,
        label: DIFFICULTIES.find((entry) => entry.value === difficulty)?.label ?? difficulty,
        remove: (current) => ({
          ...current,
          difficulties: current.difficulties.filter((d) => d !== difficulty),
        }),
      });
    }
    for (const level of filter.mastery) {
      chips.push({
        key: `mastery:${level}`,
        label: MASTERY_LABELS[level],
        remove: (current) => ({ ...current, mastery: current.mastery.filter((m) => m !== level) }),
      });
    }
    if (filter.addedWithinDays !== undefined) {
      chips.push({
        key: 'added',
        label:
          ADDED_WINDOWS.find((window) => window.days === filter.addedWithinDays)?.label ??
          `Last ${filter.addedWithinDays} days`,
        remove: (current) => ({ ...current, addedWithinDays: undefined }),
      });
    }
    if (filter.flaggedOnly) {
      chips.push({
        key: 'flagged',
        label: 'Reported',
        remove: (current) => ({ ...current, flaggedOnly: false }),
      });
    }
    return chips;
  }, [filter]);

  const toggle = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /*
    Selecting the whole view, filters and all.

    The reason this screen has filters is that "everything about X" is the unit
    people think in — so the fast path has to be "narrow it down, then take the
    lot", not tapping two hundred rows. Adds to the selection rather than
    replacing it, so two passes with different filters compose.
  */
  const selectAll = useCallback(() => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const question of filtered) next.add(question.id);
      return next;
    });
  }, [filtered]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  /** How much of the current view is already ticked, for the toolbar's labels. */
  const selectedHere = useMemo(
    () => filtered.reduce((total, question) => total + (selected.has(question.id) ? 1 : 0), 0),
    [filtered, selected],
  );

  const confirmDelete = useCallback(() => {
    const ids = [...selected];
    if (ids.length === 0) return;

    /*
      The count is said twice — in the title and again on the button — because
      the selection can reach beyond what is on screen. Someone who selected all
      under one filter and then changed it is looking at five rows with two
      hundred ticked, and the number in the dialog is the only thing that says
      so before the delete happens.
    */
    Alert.alert(
      `Delete ${ids.length} question${ids.length === 1 ? '' : 's'}?`,
      'Their review history goes with them, and any quiz in progress drops the ones it had not asked yet. Your notes and quizzes are untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${ids.length}`,
          style: 'destructive',
          onPress: () => {
            deleteQuestions(ids);
            exitSelection();
          },
        },
      ],
    );
  }, [selected, exitSelection]);

  const renderItem = ({ item }: { item: Question }) => {
    const isSelected = selected.has(item.id);
    const level = masteryOf(reviewStates[item.id]);

    return (
      <ListRow
        title={item.prompt}
        subtitle={`${summarizeQuestion(item)} · ${item.topics.map(formatTopic).join(', ') || 'no topic'}${
          item.flagged ? ' · reported' : ''
        }`}
        // In selection mode the row's whole job is the tick. Navigating away
        // mid-selection would lose it, so the tap is taken over rather than
        // shared with a long-press or a hit area only a thumbnail wide.
        onPress={selecting ? () => toggle(item.id) : () => router.push(`/questions/${encodeURIComponent(item.id)}`)}
        icon={selecting ? (isSelected ? 'checkmark-circle' : 'ellipse-outline') : undefined}
        iconColor={isSelected ? colors.primary : colors.textFaint}
        accessory={<MasteryDot level={level} />}
        showChevron={!selecting}
      />
    );
  };

  const narrowed = activeCount > 0 || filter.search.trim().length > 0;

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: selecting
            ? `${selected.size} selected`
            : 'Question bank',
          headerRight: () =>
            selecting ? (
              <HeaderIconButton
                name="close"
                accessibilityLabel="Done selecting"
                onPress={exitSelection}
              />
            ) : questions.length > 0 ? (
              <HeaderIconButton
                name="create-outline"
                accessibilityLabel="Select questions to delete"
                onPress={() => setSelecting(true)}
              />
            ) : null,
        }}
      />
      {/*
        The one screen that genuinely needs virtualization — a `.map()` inside a
        ScrollView (the convention everywhere else) will not hold thousands of
        rows. Deliberate departure.
      */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        // `selected` is not read by `data`, so without this the rows keep the
        // ticks they were rendered with and selection appears to do nothing.
        extraData={selected}
        style={styles.list}
        contentContainerStyle={[
          styles.content,
          selecting ? { paddingBottom: barHeight + spacing.md } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.filters}>
            <TextField
              placeholder="Search questions"
              value={filter.search}
              onChangeText={(search) => setFilter((current) => ({ ...current, search }))}
              clearButtonMode="while-editing"
            />

            <ChipGroup scroll>
              <Chip
                icon="options-outline"
                label={activeCount > 0 ? `Filters & sort · ${activeCount}` : 'Filters & sort'}
                onPress={() => setSheetOpen(true)}
              />
              {activeChips.map((chip) => (
                <Chip
                  key={chip.key}
                  label={chip.label}
                  selected
                  onPress={() => setFilter((current) => chip.remove(current))}
                />
              ))}
            </ChipGroup>

            {narrowed ? (
              <Text style={styles.countLine}>
                {filtered.length} of {questions.length} question{questions.length === 1 ? '' : 's'}
              </Text>
            ) : null}

            {selecting ? (
              <View style={styles.selectionBar}>
                <Button
                  title={
                    selectedHere === filtered.length && filtered.length > 0
                      ? `All ${filtered.length} selected`
                      : `Select all ${filtered.length}`
                  }
                  variant="secondary"
                  onPress={selectAll}
                  disabled={filtered.length === 0 || selectedHere === filtered.length}
                  style={styles.selectAll}
                />
                {selected.size > 0 ? (
                  <Button title="Clear" variant="plain" onPress={() => setSelected(new Set())} />
                ) : null}
              </View>
            ) : null}
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

      <FilterSheet
        visible={sheetOpen}
        filter={filter}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
        matchCount={filtered.length}
      />

      {/*
        Fixed rather than scrolled with the list: the whole point of selecting
        across a long view is that the action stays reachable at row two hundred.
      */}
      {selecting ? (
        <View
          style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}
          onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
        >
          {selected.size > selectedHere ? (
            <Text style={styles.beyond}>
              {selected.size - selectedHere} selected outside this view
            </Text>
          ) : null}
          <Button
            title={
              selected.size === 0
                ? 'Select questions to delete'
                : `Delete ${selected.size} question${selected.size === 1 ? '' : 's'}`
            }
            variant="destructive"
            onPress={confirmDelete}
            disabled={selected.size === 0}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  filters: { gap: spacing.sm, marginBottom: spacing.sm },
  countLine: { ...type.small, color: colors.textMuted },
  selectionBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectAll: { flex: 1 },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  beyond: { ...type.small, color: colors.textMuted, textAlign: 'center' },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sheetTitle: { ...type.heading, color: colors.text },
  sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  sheetLabel: {
    ...type.overline,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  sheetFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
}));
