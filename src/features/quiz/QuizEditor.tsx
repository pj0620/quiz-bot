import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { hashString } from '../../lib/random';
import { describeDraw } from '../../quiz/selection/describeRule';
import { describeAvailability } from '../../quiz/selection/select';
import { upsertQuiz } from '../../quiz/store';
import { formatTopic } from '../../quiz/topics';
import { useQuestions, useReviewStates, useTopicVocabulary } from '../../quiz/useQuiz';
import type { Quiz, QuizMix, QuizRule } from '../../quiz/types';
import { Button } from '../../ui/components/Button';
import { Callout } from '../../ui/components/Callout';
import { Card } from '../../ui/components/Card';
import { Chip, ChipGroup } from '../../ui/components/Chip';
import { Screen } from '../../ui/components/Screen';
import { SectionHeader } from '../../ui/components/SectionHeader';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { TextField } from '../../ui/components/TextField';
import { colors, spacing, type } from '../../ui/theme';

const SIZES = [5, 10, 15, 20];
const WINDOWS = [0, 3, 7, 30];

const MIX_OPTIONS: { value: QuizMix; label: string }[] = [
  { value: 'balanced', label: 'Mixed' },
  { value: 'new-only', label: 'New' },
  { value: 'review-only', label: 'Review' },
];

type Props = {
  /** Absent when creating. */
  existing?: Quiz;
};

export function QuizEditor({ existing }: Props) {
  const router = useRouter();
  const questions = useQuestions();
  const reviewStates = useReviewStates();
  const vocabulary = useTopicVocabulary();
  const now = Date.now();

  const [name, setName] = useState(existing?.name ?? '');
  const [topics, setTopics] = useState<string[]>(existing?.rule.topics ?? []);
  const [size, setSize] = useState(existing?.rule.size ?? 10);
  const [mix, setMix] = useState<QuizMix>(existing?.rule.mix ?? 'balanced');
  const [windowDays, setWindowDays] = useState(existing?.rule.addedWithinDays ?? 0);

  const rule: QuizRule = useMemo(
    () => ({
      size,
      mix,
      topics: topics.length ? topics : undefined,
      addedWithinDays: windowDays > 0 ? windowDays : undefined,
      maxMastery: existing?.rule.maxMastery,
      sourceIds: existing?.rule.sourceIds,
    }),
    [size, mix, topics, windowDays, existing],
  );

  /**
   * Live match count.
   *
   * Non-negotiable: rules matching too little will be common early on, and
   * finding out only after saving is a bad experience.
   */
  const availability = useMemo(
    () => describeAvailability({ bank: questions, reviewStates, rule, now }),
    [questions, reviewStates, rule, now],
  );

  const toggleTopic = useCallback((topic: string) => {
    setTopics((current) =>
      current.includes(topic) ? current.filter((entry) => entry !== topic) : [...current, topic],
    );
  }, []);

  const save = useCallback(() => {
    const trimmed = name.trim();
    const finalName = trimmed || (topics.length ? topics.map(formatTopic).join(' & ') : 'Untitled quiz');

    upsertQuiz({
      id: existing?.id ?? `quiz-${hashString(`${finalName}${Date.now()}`).toString(36)}`,
      name: finalName,
      icon: existing?.icon ?? 'albums-outline',
      builtin: existing?.builtin,
      createdAt: existing?.createdAt ?? Date.now(),
      lastSessionAt: existing?.lastSessionAt,
      rule,
    });
    router.back();
  }, [name, topics, existing, rule, router]);

  return (
    <Screen>
      <TextField
        label="Name"
        placeholder={topics.length ? topics.map(formatTopic).join(' & ') : 'e.g. American History'}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />

      <SectionHeader title="Topics" />
      {vocabulary.length === 0 ? (
        <Callout
          tone="info"
          message="No topics yet — generate questions from a source and they'll appear here."
        />
      ) : (
        <>
          {/*
            Topics are PICKED, never typed. A free-text field would let someone
            create a quiz matching nothing because they guessed a topic the bank
            has never seen.
          */}
          <ChipGroup>
            {vocabulary.slice(0, 24).map(({ topic, count }) => (
              <Chip
                key={topic}
                label={formatTopic(topic)}
                count={count}
                selected={topics.includes(topic)}
                onPress={() => toggleTopic(topic)}
              />
            ))}
          </ChipGroup>
          <Text style={styles.hint}>
            {topics.length === 0 ? 'No topic filter — draws from everything' : 'Matches any selected topic'}
          </Text>
        </>
      )}

      <SectionHeader title="Recency" />
      <ChipGroup scroll>
        {WINDOWS.map((days) => (
          <Chip
            key={days}
            label={days === 0 ? 'Any time' : `Last ${days} days`}
            selected={windowDays === days}
            onPress={() => setWindowDays(days)}
          />
        ))}
      </ChipGroup>

      <SectionHeader title="Mix" />
      <SegmentedControl options={MIX_OPTIONS} value={mix} onChange={setMix} />

      <SectionHeader title="Questions per run" />
      <ChipGroup scroll>
        {SIZES.map((value) => (
          <Chip key={value} label={String(value)} selected={size === value} onPress={() => setSize(value)} />
        ))}
      </ChipGroup>

      <Card tone="inset">
        <Text style={styles.preview}>{describeDraw(rule, availability.matching)}</Text>
        <Text style={styles.previewMeta}>
          {availability.new} new · {availability.due} due · {availability.notYetDue} resting
        </Text>
        {availability.matching === 0 ? (
          <Callout tone="warning" message="Nothing matches yet. Try removing a filter." />
        ) : null}
      </Card>

      <View style={styles.footer}>
        <Button title={existing ? 'Save changes' : 'Create quiz'} onPress={save} />
        <Button title="Cancel" variant="plain" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { ...type.small, color: colors.textFaint },
  preview: { ...type.bodyStrong, color: colors.text },
  previewMeta: { ...type.small, color: colors.textMuted },
  footer: { gap: spacing.sm, marginTop: spacing.md },
});
