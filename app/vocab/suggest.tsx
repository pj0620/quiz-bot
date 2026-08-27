import {
  useCallback,
  useMemo,
  useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Stack,
  useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { resolveCredentialsOrNull } from '../../src/features/llm/credentials';
import {
  suggestVocabWords,
  type VocabSuggestion,
} from '../../src/features/llm/suggestVocabWords';
import { useTopicVocabulary } from '../../src/quiz/useQuiz';
import { useVocabThemes, useWordsPerBatch } from '../../src/quiz/vocab/preferences';
import { startVocabRun } from '../../src/quiz/vocab/runStore';
import { addWords, getVocabWords } from '../../src/quiz/vocab/store';
import { VOCAB_TOPIC } from '../../src/quiz/vocab/types';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { ListRow } from '../../src/ui/components/ListRow';
import { LoadingBlock } from '../../src/ui/components/LoadingBlock';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

/**
 * Two states in one screen: pick a theme, then choose from what came back.
 *
 * The review step is the whole point of this flow. Suggesting is one cheap
 * request; writing questions is one request per word. Choosing in between is
 * what stops the reader paying for eight words they did not want, and it keeps
 * the bank something they curated rather than something that arrived.
 *
 * A plain stack screen rather than a modal: it pushes onward to the word list
 * once words are accepted, and a modal has nowhere to push to.
 */
export default function SuggestWordsScreen() {
  const router = useRouter();
  const themes = useVocabThemes();
  const wordsPerBatch = useWordsPerBatch();
  const topics = useTopicVocabulary();

  const [themeId, setThemeId] = useState(() => themes[0]?.id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [suggestions, setSuggestions] = useState<VocabSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const theme = useMemo(() => themes.find((entry) => entry.id === themeId), [themes, themeId]);

  /** Their own topics, minus the one every vocab question already carries. */
  const studying = useMemo(
    () => topics.map(({ topic }) => topic).filter((topic) => topic !== VOCAB_TOPIC),
    [topics],
  );

  const suggest = useCallback(
    async (extraAvoid: readonly string[] = []) => {
      setLoading(true);
      setError(null);
      try {
        const credentials = await resolveCredentialsOrNull('generate');
        if (!credentials) throw new Error('Set up a model in Settings first.');

        const avoid = [...Object.keys(getVocabWords()), ...extraAvoid];
        const result = await suggestVocabWords({
          count: wordsPerBatch,
          ...(theme?.label ? { theme: theme.label } : {}),
          // Only the notes-aware theme gets the reader's subjects; the others
          // are meant to range wider than what they happen to be studying.
          ...(theme?.kind === 'notes' && studying.length > 0 ? { topics: studying } : {}),
          avoid,
          provider: credentials.provider,
          apiKey: credentials.apiKey,
          model: credentials.model,
        });

        setSuggestions(result.words);
        // Everything ticked to start with: the reader is deselecting the few
        // they know, not opting in to each one.
        setPicked(new Set(result.words.map((word) => word.word)));
      } catch (caught) {
        setError(caught);
      } finally {
        setLoading(false);
      }
    },
    [theme, wordsPerBatch, studying],
  );

  const toggle = useCallback((word: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }, []);

  const accept = useCallback(
    (thenGenerate: boolean) => {
      const chosen = (suggestions ?? []).filter((word) => picked.has(word.word));
      if (chosen.length === 0) return;

      const { added } = addWords(
        chosen.map((word) => ({
          word: word.word,
          definition: word.definition,
          ...(word.partOfSpeech ? { partOfSpeech: word.partOfSpeech } : {}),
          ...(theme?.label ? { theme: theme.label } : {}),
          addedBy: 'ai' as const,
        })),
      );

      if (thenGenerate && added.length > 0) void startVocabRun(added);
      // Replace, so Back does not return to a suggestion set already accepted.
      router.replace('/vocab');
    },
    [suggestions, picked, theme, router],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Suggest words' }} />
      <Screen>
        {suggestions === null ? (
          <>
            <Card title="What kind of words?">
              {themes.length === 0 ? (
                <Callout tone="info" message="Add a theme in Settings to steer what gets suggested." />
              ) : (
                <ChipGroup>
                  {themes.map((entry) => (
                    <Chip
                      key={entry.id}
                      label={entry.label}
                      selected={entry.id === themeId}
                      onPress={() => setThemeId(entry.id)}
                    />
                  ))}
                </ChipGroup>
              )}

              {theme?.kind === 'notes' ? (
                <Text style={styles.hint}>
                  {studying.length > 0
                    ? `Draws on what you're studying: ${studying.slice(0, 4).join(', ')}.`
                    : 'Nothing in your bank to draw on yet — this will suggest general words.'}
                </Text>
              ) : null}

              <Text style={styles.hint}>
                One cheap request. Nothing is added to your list until you choose.
              </Text>

              <Button
                title={`Suggest ${wordsPerBatch} words`}
                onPress={() => void suggest()}
                loading={loading}
                disabled={loading}
              />
              <Button
                title="Edit themes in Settings"
                variant="plain"
                onPress={() => router.push('/settings')}
              />
            </Card>

            {loading ? <LoadingBlock message="Thinking of words…" size="inline" /> : null}
            {error ? <ErrorBanner error={error} onRetry={() => void suggest()} /> : null}
          </>
        ) : (
          <>
            <Callout
              tone="info"
              message="Pick the ones you want. Writing questions for each is a separate request."
            />

            <SectionHeader title={`${picked.size} of ${suggestions.length} chosen`} />

            <View style={styles.list}>
              {suggestions.map((word) => (
                <ListRow
                  key={word.word}
                  title={word.word}
                  subtitle={[word.partOfSpeech, word.definition].filter(Boolean).join(' · ')}
                  onPress={() => toggle(word.word)}
                  accessory={
                    <Ionicons
                      name={picked.has(word.word) ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={picked.has(word.word) ? colors.primary : colors.textFaint}
                    />
                  }
                />
              ))}
            </View>

            {error ? <ErrorBanner error={error} /> : null}

            <Button
              title={`Add ${picked.size} word${picked.size === 1 ? '' : 's'} and write questions`}
              onPress={() => accept(true)}
              disabled={picked.size === 0 || loading}
            />
            <Button
              title="Add without questions"
              variant="secondary"
              onPress={() => accept(false)}
              disabled={picked.size === 0 || loading}
            />
            <Button
              title="Suggest a different set"
              variant="plain"
              // The set just shown joins the avoid list, so a re-roll is
              // genuinely different rather than the same ten words again.
              onPress={() => void suggest(suggestions.map((word) => word.word))}
              disabled={loading}
            />
          </>
        )}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  list: { gap: spacing.sm },
  hint: { ...type.small, color: colors.textFaint },
}));
