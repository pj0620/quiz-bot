import {
  useCallback,
  useMemo } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { formatDayOffset, formatInterval } from '../../src/lib/day';
import { getAnswerView, getQuestionLogic } from '../../src/quiz/questionTypes';
import { formatTopic } from '../../src/quiz/topics';
import { MASTERY_LABELS, masteryOf } from '../../src/quiz/srs/mastery';
import { flagQuestion, resetReview, unflagQuestion } from '../../src/quiz/store';
import { useQuestion, useReviewStates } from '../../src/quiz/useQuiz';
import { isPromptQuestion } from '../../src/quiz/promptSource';
import { isVocabQuestion, slugFromPath } from '../../src/quiz/vocab/types';
import { geographyLocationOf } from '../../src/quiz/geography/catalog';
import type { Grade } from '../../src/quiz/types';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { NoteSource } from '../../src/ui/components/NoteSource';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { MasteryDot } from '../../src/ui/components/MasteryDot';
import { QuestionFigureView } from '../../src/ui/components/QuestionFigureView';
import { QuestionLocation } from '../../src/ui/components/QuestionLocation';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

export default function QuestionDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const question = useQuestion(id);
  const reviewStates = useReviewStates();
  const state = id ? reviewStates[id] : undefined;

  /**
   * A synthetic pre-revealed grade so the registry's AnswerView renders in
   * read-only "here's the answer" mode.
   *
   * This reuse is the payoff of the registry: no second renderer per format.
   */
  const revealedGrade: Grade = useMemo(() => ({ status: 'graded', outcome: 'correct', score: 1 }), []);

  const toggleFlag = useCallback(() => {
    if (!question) return;
    if (question.flagged) unflagQuestion(question.id);
    else flagQuestion(question.id, 'not-useful');
  }, [question]);

  if (!question) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title="Question not found" actionTitle="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  const logic = getQuestionLogic(question.format);
  const AnswerView = getAnswerView(question.format);
  const level = masteryOf(state);
  const vocabSlug = slugFromPath(question.provenance.path);

  return (
    <>
      <Stack.Screen options={{ title: logic.label }} />
      <Screen>
        <View style={styles.metaRow}>
          <Badge label={logic.label} />
          <Badge label={question.difficulty} />
          {question.flagged ? <Badge label="Reported" tone="danger" /> : null}
        </View>

        <Text style={styles.prompt} selectable>
          {question.prompt}
        </Text>

        {question.figure ? <QuestionFigureView figure={question.figure} /> : null}

        <AnswerView
          question={question}
          answer={null as never}
          onChange={() => undefined}
          grade={revealedGrade}
          disabled
        />

        <Callout tone="info" title="Why" message={question.explanation} />

        {question.topics.length > 0 ? (
          <>
            <SectionHeader title="Topics" />
            <ChipGroup>
              {question.topics.map((topic) => (
                <Chip
                  key={topic}
                  label={formatTopic(topic)}
                  onPress={() => router.push({ pathname: '/questions', params: { topic } })}
                />
              ))}
            </ChipGroup>
          </>
        ) : null}

        {/*
          Neither vocabulary nor geography has a note behind it, and `NoteSource`
          cannot cope with that: it renders "Read the full note" for anything
          with a path, and tapping it resolves a source ('vocab', 'geography')
          that does not exist. Both are required branches rather than niceties —
          the vocab one would otherwise caption the word as a note title and fail
          on the tap, and the geography one would read `us-states/us-tn` as a
          file and go looking for it in a repository.
        */}
        {geographyLocationOf(question) ? (
          <QuestionLocation question={question} />
        ) : isPromptQuestion(question) ? (
          /*
            The same reasoning as the vocab branch below: nothing on disk backs
            this question, so `NoteSource` has nothing to expand and its
            caption would just repeat the excerpt. What IS worth offering is
            the way to get more — the prompt screen, pre-filled.
          */
          <Card title="From your prompt" tone="inset">
            <Text style={styles.vocabDefinition} selectable>
              {question.provenance.noteTitle ?? 'A subject you asked about'}
            </Text>
            {question.provenance.noteTitle ? (
              <Button
                title="Ask for more like this"
                variant="plain"
                onPress={() =>
                  router.push({
                    pathname: '/generate/topic',
                    params: { topic: question.provenance.noteTitle },
                  })
                }
              />
            ) : null}
          </Card>
        ) : isVocabQuestion(question) ? (
          <Card title="Vocabulary" tone="inset">
            <Text style={styles.vocabWord} selectable>
              {question.provenance.noteTitle}
            </Text>
            {question.provenance.excerpt ? (
              <Text style={styles.vocabDefinition} selectable>
                {question.provenance.excerpt}
              </Text>
            ) : null}
            {vocabSlug ? (
              <Button
                title="See this word"
                variant="plain"
                onPress={() => router.push(`/vocab/${encodeURIComponent(vocabSlug)}`)}
              />
            ) : null}
          </Card>
        ) : (
          <Card title="From your notes" tone="inset">
            <NoteSource provenance={question.provenance} />
            {/* The repository path stays available, just demoted below the note
                itself — it's what you need to go and edit the source. */}
            <Text style={styles.path} numberOfLines={2} ellipsizeMode="middle">
              {question.provenance.path ?? 'Unknown location'}
              {question.provenance.revision ? ` · ${question.provenance.revision.slice(0, 7)}` : ''}
            </Text>
          </Card>
        )}

        <Card title="Review history" tone="inset">
          <View style={styles.historyRow}>
            <MasteryDot level={level} showLabel />
            <Text style={styles.historyMeta}>
              {state
                ? `${state.reps} review${state.reps === 1 ? '' : 's'} · ${state.lapses} lapse${state.lapses === 1 ? '' : 's'}`
                : 'Never answered'}
            </Text>
          </View>
          {state ? (
            <Text style={styles.historyMeta}>
              Next {formatDayOffset(state.dueAt, Date.now())} · interval {formatInterval(state.intervalDays)}
              {state.leech ? ' · marked difficult' : ''}
            </Text>
          ) : null}
        </Card>

        <Button
          title="Practise this now"
          onPress={() =>
            router.push({
              pathname: '/session/start',
              params: { questionIds: question.id, name: 'Practice' },
            })
          }
        />
        {/* The same editor the player pushes to. Reachable from here too,
            because most bad questions are noticed while browsing the bank
            rather than mid-quiz — and delete lives inside it. */}
        <Button
          title="Edit this question"
          variant="secondary"
          onPress={() => router.push(`/questions/edit/${encodeURIComponent(question.id)}`)}
        />
        <Button
          title={question.flagged ? 'Un-report this question' : 'Report this question'}
          variant={question.flagged ? 'secondary' : 'destructive'}
          onPress={toggleFlag}
        />
        {__DEV__ && state ? (
          <Button title="Reset progress (dev)" variant="plain" onPress={() => resetReview(question.id)} />
        ) : null}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  metaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  prompt: { ...type.heading, color: colors.text, lineHeight: 28 },
  path: { ...type.mono, color: colors.textMuted },
  vocabWord: { ...type.heading, color: colors.text },
  vocabDefinition: { ...type.body, color: colors.textMuted, lineHeight: 24 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  historyMeta: { ...type.small, color: colors.textMuted },
}));
