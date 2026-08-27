import {
  useCallback,
  useMemo,
  useState } from 'react';
import { Stack,
  useRouter } from 'expo-router';
import { KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';

import { hashString } from '../../src/lib/random';
import { upsertQuiz } from '../../src/quiz/store';
import { addWord } from '../../src/quiz/vocab/store';
import { validateWord } from '../../src/quiz/vocab/types';
import { useVocabList, useVocabReady } from '../../src/quiz/vocab/useVocab';
import {
  cancelVocabRun,
  resetVocabRun,
  startVocabRun,
  vocabRunStore,
} from '../../src/quiz/vocab/runStore';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { HeaderIconButton } from '../../src/ui/components/HeaderIconButton';
import { ListRow } from '../../src/ui/components/ListRow';
import { ProgressBar } from '../../src/ui/components/ProgressBar';
import { RunNoteRow } from '../../src/ui/components/RunNoteRow';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { TextField } from '../../src/ui/components/TextField';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

/**
 * The word list, and the one place a word is added.
 *
 * Adding is inline rather than behind a modal, unlike `sources/new`: it is the
 * primary action here and typing a word is a single field, so a navigation
 * transition would cost more than it explains.
 *
 * A `.map()` in a ScrollView rather than a FlatList, matching every screen but
 * the question bank. Worth revisiting past a couple of hundred words; a
 * vocabulary list is not the screen that holds thousands of rows.
 */
export default function VocabScreen() {
  const router = useRouter();
  const entries = useVocabList();
  const ready = useVocabReady();
  const run = vocabRunStore.use();

  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);

  const running = run.status === 'running';
  const showRun = run.status !== 'idle';

  const settled = useMemo(
    () => run.words.filter((word) => word.status !== 'pending' && word.status !== 'running').length,
    [run.words],
  );
  const progress = run.words.length === 0 ? 0 : settled / run.words.length;

  /** Words that have never produced anything — the retry offer. */
  const unwritten = useMemo(
    () => entries.filter((entry) => entry.questions.length === 0).map((entry) => entry.word.slug),
    [entries],
  );
  const totalQuestions = useMemo(
    () => entries.reduce((total, entry) => total + entry.questions.length, 0),
    [entries],
  );

  const add = useCallback(
    (thenGenerate: boolean) => {
      const validation = validateWord(draft);
      if (!validation.ok) {
        setError(validation.reason);
        return;
      }

      setError(null);
      const result = addWord({
        word: validation.word,
        ...(note.trim() ? { definition: note.trim() } : {}),
        addedBy: 'user',
      });

      // Not an error: they already have it, and saying so beats a field that
      // clears with nothing to show for it.
      setDuplicate(result.added ? null : validation.word);
      setDraft('');
      setNote('');

      if (result.added && thenGenerate && ready) void startVocabRun([result.slug]);
    },
    [draft, note, ready],
  );

  /**
   * A quiz over the vocabulary topic, created on demand.
   *
   * Deliberately not seeded into `BUILTIN_QUIZZES`: that runs on every install,
   * and someone who never adds a word would be shown a permanently empty quiz.
   * A fixed id keeps it idempotent, and no `builtin` flag keeps it deletable.
   */
  const quizMe = useCallback(() => {
    const id = `quiz-${hashString('vocabulary').toString(36)}`;
    upsertQuiz({
      id,
      name: 'Vocabulary',
      icon: 'book-outline',
      createdAt: Date.now(),
      rule: { topics: ['vocabulary'], size: 10, mix: 'balanced' },
    });
    router.push(`/quiz/${encodeURIComponent(id)}`);
  }, [router]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Vocabulary',
          headerRight: () => (
            <HeaderIconButton
              name="sparkles-outline"
              accessibilityLabel="Suggest words"
              onPress={() => router.push('/vocab/suggest')}
            />
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen>
          {!ready ? (
            <Callout
              tone="warning"
              title="No model configured"
              message="Words are still saved — you can write questions for them once a provider is set up."
            >
              <Button
                title="Open Settings"
                variant="secondary"
                onPress={() => router.push('/settings')}
              />
            </Callout>
          ) : null}

          <Card title="Add a word">
            <TextField
              placeholder="e.g. laconic, ad hoc"
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setError(null);
                setDuplicate(null);
              }}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={() => add(true)}
              {...(error ? { error } : {})}
            />
            {/* Disclosed only once there is a word, so the common case is one field. */}
            {draft.trim() ? (
              <TextField
                label="What you think it means (optional)"
                placeholder="Steers which sense it asks about"
                value={note}
                onChangeText={setNote}
                autoCapitalize="none"
              />
            ) : null}

            {duplicate ? (
              <Callout tone="info" message={`"${duplicate}" is already in your list.`} />
            ) : null}

            <Button
              title={ready ? 'Add and write questions' : 'Add word'}
              onPress={() => add(true)}
              disabled={running}
            />
            {ready ? (
              <Button title="Add without questions" variant="plain" onPress={() => add(false)} />
            ) : null}
          </Card>

          {showRun ? (
            <Card title={running ? 'Writing questions' : 'Finished'}>
              <ProgressBar value={progress} />
              <Text style={styles.runMeta}>
                {run.added} question{run.added === 1 ? '' : 's'} added from {settled} of{' '}
                {run.words.length} word{run.words.length === 1 ? '' : 's'}
              </Text>
              <Text style={styles.runMeta}>
                {run.usage.inputTokens.toLocaleString()} in ·{' '}
                {run.usage.outputTokens.toLocaleString()} out
              </Text>

              {run.words.map((word) => (
                <RunNoteRow key={word.key} note={word} />
              ))}

              {run.error ? <ErrorBanner error={run.error} /> : null}

              {running ? (
                <Button title="Cancel" variant="destructive" onPress={cancelVocabRun} />
              ) : (
                <Button title="Dismiss" variant="plain" onPress={resetVocabRun} />
              )}
            </Card>
          ) : null}

          {entries.length === 0 ? (
            <EmptyState
              icon="book-outline"
              title="No words yet"
              body="Add a word you keep meaning to learn, or let the model suggest some."
              actionTitle="Suggest some words"
              onAction={() => router.push('/vocab/suggest')}
            />
          ) : (
            <>
              <SectionHeader
                title={`${entries.length} word${entries.length === 1 ? '' : 's'}`}
                accessory={
                  <Text style={styles.headerMeta}>
                    {totalQuestions} question{totalQuestions === 1 ? '' : 's'}
                  </Text>
                }
              />

              <View style={styles.list}>
                {entries.map(({ word, questions }) => (
                  <ListRow
                    key={word.slug}
                    title={word.word}
                    subtitle={
                      [word.partOfSpeech, word.definition ?? word.lastError].filter(Boolean).join(' · ') ||
                      'No definition yet'
                    }
                    onPress={() => router.push(`/vocab/${encodeURIComponent(word.slug)}`)}
                    accessory={
                      questions.length > 0 ? (
                        <Badge label={String(questions.length)} />
                      ) : (
                        <Badge label="none yet" tone="warning" />
                      )
                    }
                    showChevron
                  />
                ))}
              </View>

              {/*
                The recovery path after clearing the question bank, which keeps
                the word list precisely so this button can rebuild from it.
              */}
              {ready && unwritten.length > 0 && !running ? (
                <Button
                  title={`Write questions for ${unwritten.length} word${unwritten.length === 1 ? '' : 's'}`}
                  variant="secondary"
                  onPress={() => void startVocabRun(unwritten)}
                />
              ) : null}

              {totalQuestions > 0 ? (
                <Button title="Quiz me on these" onPress={quizMe} />
              ) : null}
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = themedSheet(() => ({
  fill: { flex: 1 },
  list: { gap: spacing.sm },
  runMeta: { ...type.small, color: colors.textMuted },
  headerMeta: { ...type.small, color: colors.textFaint },
}));
