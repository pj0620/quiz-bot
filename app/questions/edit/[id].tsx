import {
  useCallback,
  useEffect,
  useMemo,
  useState } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import { Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';

import { resolveCredentialsOrNull } from '../../../src/features/llm/credentials';
import { reviseQuestion } from '../../../src/features/llm/reviseQuestion';
import { useGuidance } from '../../../src/features/llm/useLlm';
import { getAnswerView, getQuestionLogic } from '../../../src/quiz/questionTypes';
import { getQuestionEditor } from '../../../src/quiz/questionTypes/editors';
import { deleteQuestion, updateQuestion } from '../../../src/quiz/store';
import { useQuestion } from '../../../src/quiz/useQuiz';
import type { Difficulty, Grade, Question } from '../../../src/quiz/types';
import { Badge } from '../../../src/ui/components/Badge';
import { Button } from '../../../src/ui/components/Button';
import { Card } from '../../../src/ui/components/Card';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../../src/ui/components/ErrorBanner';
import { Screen } from '../../../src/ui/components/Screen';
import { SectionHeader } from '../../../src/ui/components/SectionHeader';
import { SegmentedControl } from '../../../src/ui/components/SegmentedControl';
import { TextField } from '../../../src/ui/components/TextField';
import { colors, spacing, themedSheet, type } from '../../../src/ui/theme';

/**
 * Editing one question, by hand or by asking the model.
 *
 * The two ways of editing are deliberately NOT two modes. They both write to
 * the same local draft, so the useful loop — ask the model to shorten it, fix
 * the one word it got wrong yourself, ask it again to add a distractor — works
 * without saving, reopening or choosing an approach up front.
 *
 * Nothing is written to the bank until Save. A model revision that turns out
 * worse is undone by leaving, which matters because a revision costs money and
 * the alternative would be needing a second one to get back.
 */

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'intro', label: 'Intro' },
  { value: 'core', label: 'Core' },
  { value: 'deep', label: 'Deep' },
];

export default function EditQuestionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;

  const saved = useQuestion(id);
  const guidance = useGuidance();

  const [draft, setDraft] = useState<Question | null>(null);
  const [instruction, setInstruction] = useState('');
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** What the last revision cost, so the price of iterating is visible. */
  const [lastUsage, setLastUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  /*
    Seeded once per question rather than on every store change.

    `useQuestion` re-reads the bank, so keying this on `saved` would throw away
    the user's in-progress edits the moment anything else touched the store.
  */
  useEffect(() => {
    setDraft((current) => (current && current.id === saved?.id ? current : (saved ?? null)));
  }, [saved]);

  /** A pre-revealed grade, so the preview renders in "here's the answer" mode. */
  const revealed: Grade = useMemo(() => ({ status: 'graded', outcome: 'correct', score: 1 }), []);

  const dirty = useMemo(
    () => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  const askModel = useCallback(async () => {
    if (!draft || !instruction.trim()) return;
    setRevising(true);
    setError(null);
    try {
      const credentials = await resolveCredentialsOrNull('generate');
      if (!credentials) throw new Error('Add an API key in Settings to revise with the model.');

      const outcome = await reviseQuestion({
        // The DRAFT, not the saved question — so a second request builds on the
        // manual fixes made since the first one, which is the whole loop.
        question: draft,
        instruction,
        provider: credentials.provider,
        apiKey: credentials.apiKey,
        model: credentials.model,
        guidance,
      });

      setDraft(outcome.question);
      setLastUsage(outcome.usage);
      // Cleared on success only: a failed request should leave what you typed
      // where it is so you can retry without retyping it.
      setInstruction('');
    } catch (caught) {
      setError(caught);
    } finally {
      setRevising(false);
    }
  }, [draft, instruction, guidance]);

  const save = useCallback(() => {
    if (!draft) return;
    updateQuestion(draft);
    router.back();
  }, [draft, router]);

  const confirmDelete = useCallback(() => {
    if (!saved) return;
    Alert.alert(
      'Delete this question?',
      'It goes from the bank along with its review history, and it will not come back on the next generation run unless the note it came from changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteQuestion(saved.id);
            router.back();
          },
        },
      ],
    );
  }, [saved, router]);

  const leave = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard your changes?', 'This question goes back to how it was.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }, [dirty, router]);

  if (!saved || !draft) {
    return (
      <>
        <Stack.Screen options={{ title: 'Edit question' }} />
        <Screen>
          <EmptyState
            icon="help-circle-outline"
            title="Question not found"
            body="It may have been deleted."
            actionTitle="Back"
            onAction={() => router.back()}
          />
        </Screen>
      </>
    );
  }

  const Editor = getQuestionEditor(draft.format);
  const AnswerView = getAnswerView(draft.format);
  const logic = getQuestionLogic(draft.format);

  return (
    <>
      <Stack.Screen options={{ title: 'Edit question' }} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen>
          <View style={styles.metaRow}>
            <Badge label={logic.label} />
            <Badge label={draft.difficulty} tone="neutral" />
          </View>

          <SectionHeader title="Question" />
          <TextField
            value={draft.prompt}
            onChangeText={(prompt) => setDraft({ ...draft, prompt })}
            placeholder="What is being asked"
            autoCapitalize="sentences"
            autoCorrect
            multiline
          />

          {/* Format-specific half, from the registry — see `editors.tsx`. */}
          <Editor question={draft} onChange={(next) => setDraft(next)} />

          <SectionHeader title="Explanation" />
          <TextField
            value={draft.explanation}
            onChangeText={(explanation) => setDraft({ ...draft, explanation })}
            placeholder="Why the answer is right — shown after answering"
            autoCapitalize="sentences"
            autoCorrect
            multiline
          />

          <SectionHeader title="Difficulty" />
          <SegmentedControl
            options={DIFFICULTIES}
            value={draft.difficulty}
            onChange={(difficulty) => setDraft({ ...draft, difficulty })}
          />

          {/*
            Asking the model sits BELOW the fields rather than above them.

            Typing the fix yourself is the cheaper and more certain path, and a
            prompt box at the top of the screen reads as the intended one.
          */}
          <Card title="Or ask the model to change it">
            <TextField
              value={instruction}
              onChangeText={setInstruction}
              placeholder={'e.g. "Say which decade this is about"\n"Make this multiple choice"\n"Shorter, and drop the jargon"'}
              autoCapitalize="sentences"
              autoCorrect
              multiline
              editable={!revising}
            />
            <Button
              title="Revise with the model"
              onPress={() => void askModel()}
              loading={revising}
              disabled={revising || !instruction.trim()}
              variant="secondary"
            />
            <Text style={styles.hint}>
              It rewrites the question above, which you can then keep editing by hand — or ask
              again. Nothing is saved until you press Save.
            </Text>
            {lastUsage ? (
              <Text style={styles.hint}>
                Last revision: {lastUsage.inputTokens.toLocaleString()} in /{' '}
                {lastUsage.outputTokens.toLocaleString()} out tokens
              </Text>
            ) : null}
          </Card>

          {error ? <ErrorBanner error={error} onRetry={() => void askModel()} /> : null}

          {/*
            A live preview, drawn by the same registry view the player uses. It
            is the only way to see what a fill-blank template or a shuffled
            multiple-choice will actually look like before saving it.
          */}
          <Card tone="inset" title="Preview">
            <Text style={styles.prompt}>{draft.prompt}</Text>
            <AnswerView
              question={draft as never}
              answer={null as never}
              onChange={() => undefined}
              grade={revealed}
              disabled
            />
            <Text style={styles.hint}>{draft.explanation}</Text>
          </Card>

          <Button title="Save" onPress={save} disabled={!dirty || !draft.prompt.trim()} />
          <Button title="Cancel" variant="plain" onPress={leave} />
          <Button title="Delete this question" variant="destructive" onPress={confirmDelete} />
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = themedSheet(() => ({
  fill: { flex: 1 },
  metaRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  prompt: { ...type.bodyStrong, color: colors.text, lineHeight: 22 },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
}));
