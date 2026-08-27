import {
  useCallback } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import { Alert,
  Text,
  View,
} from 'react-native';

import { summarizeQuestion } from '../../src/quiz/questionTypes';
import { masteryOf } from '../../src/quiz/srs/mastery';
import { useReviewStates } from '../../src/quiz/useQuiz';
import { removeWord } from '../../src/quiz/vocab/store';
import { startVocabRun, vocabRunStore } from '../../src/quiz/vocab/runStore';
import { useVocabEntry, useVocabReady } from '../../src/quiz/vocab/useVocab';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ListRow } from '../../src/ui/components/ListRow';
import { MasteryDot } from '../../src/ui/components/MasteryDot';
import { RunNoteRow } from '../../src/ui/components/RunNoteRow';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

export default function WordDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : undefined;
  const entry = useVocabEntry(slug);
  const reviewStates = useReviewStates();
  const ready = useVocabReady();

  // The batch panel is shared, so a single-word run started from here shows the
  // same row the list screen would show.
  const runWord = vocabRunStore.useSelector((state) =>
    state.status === 'running' ? state.words.find((word) => word.key === slug) : undefined,
  );

  const confirmDelete = useCallback(() => {
    if (!entry) return;
    const count = entry.questions.length;
    Alert.alert(
      `Remove "${entry.word.word}"?`,
      count > 0
        ? `This also deletes its ${count} question${count === 1 ? '' : 's'} and your progress on them.`
        : 'It has no questions yet, so nothing else goes with it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeWord(entry.word.slug);
            router.back();
          },
        },
      ],
    );
  }, [entry, router]);

  if (!entry) {
    return (
      <Screen>
        <EmptyState
          icon="help-circle-outline"
          title="Word not found"
          actionTitle="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const { word, questions } = entry;

  return (
    <>
      <Stack.Screen options={{ title: word.word }} />
      <Screen>
        <View style={styles.metaRow}>
          {word.partOfSpeech ? <Badge label={word.partOfSpeech} /> : null}
          <Badge label={word.addedBy === 'ai' ? 'Suggested' : 'Yours'} />
          {questions.length === 0 ? <Badge label="No questions yet" tone="warning" /> : null}
        </View>

        <Text style={styles.word} selectable>
          {word.word}
        </Text>
        {word.definition ? (
          <Text style={styles.definition} selectable>
            {word.definition}
          </Text>
        ) : null}

        {word.lastError ? (
          <Callout
            tone="warning"
            title="The last attempt didn't work"
            message={word.lastError}
          />
        ) : null}

        {runWord ? <RunNoteRow note={runWord} /> : null}

        {questions.length > 0 ? (
          <>
            <SectionHeader title={`${questions.length} question${questions.length === 1 ? '' : 's'}`} />
            <View style={styles.list}>
              {questions.map((question) => (
                <ListRow
                  key={question.id}
                  title={question.prompt}
                  subtitle={summarizeQuestion(question)}
                  onPress={() => router.push(`/questions/${encodeURIComponent(question.id)}`)}
                  accessory={<MasteryDot level={masteryOf(reviewStates[question.id])} />}
                  showChevron
                />
              ))}
            </View>

            <Button
              title="Practise this word"
              onPress={() =>
                router.push({
                  pathname: '/session/start',
                  params: {
                    questionIds: questions.map((question) => question.id).join(','),
                    name: word.word,
                  },
                })
              }
            />
          </>
        ) : null}

        {ready ? (
          <Button
            title={questions.length > 0 ? 'Write more questions' : 'Write questions'}
            variant={questions.length > 0 ? 'secondary' : 'primary'}
            // The existing prompts ride along, so a second run finds new angles
            // rather than rewording what is already here.
            onPress={() => void startVocabRun([word.slug])}
            disabled={!!runWord}
          />
        ) : (
          <Button
            title="Set up a model to write questions"
            variant="secondary"
            onPress={() => router.push('/settings')}
          />
        )}

        <Button title="Remove this word" variant="destructive" onPress={confirmDelete} />
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  metaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  word: { ...type.title, color: colors.text },
  definition: { ...type.body, color: colors.textMuted, lineHeight: 24 },
  list: { gap: spacing.sm },
}));
