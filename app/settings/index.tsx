import { useCallback, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { looksLikeKeyFor, type LlmProviderDefinition } from '../../src/features/llm/contract';
import { readApiKey } from '../../src/features/llm/auth/secureKeyStore';
import { generateFromNote } from '../../src/features/llm/generateFromNote';
import { listLlmProviders } from '../../src/features/llm/registry';
import { getSampleNote, SAMPLE_NOTE_PATH } from '../../src/features/llm/sampleNote';
import { removeApiKey, saveApiKey, setGeneratorId, setModel } from '../../src/features/llm/settings';
import { useGeneratorId, useKeyStatus, useModelFor } from '../../src/features/llm/useLlm';
import type { GeneratorId } from '../../src/features/llm/types';
import { clearAllCoverage, coverageStore } from '../../src/quiz/generation/coverageStore';
import { getAnswerView, getQuestionLogic } from '../../src/quiz/questionTypes';
import { clearQuestionBank } from '../../src/quiz/store';
import { useQuestions } from '../../src/quiz/useQuiz';
import type { Grade, Question } from '../../src/quiz/types';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { SegmentedControl } from '../../src/ui/components/SegmentedControl';
import { TextField } from '../../src/ui/components/TextField';
import { colors, spacing, type } from '../../src/ui/theme';

/** How many questions the test asks for. Small — this runs on the user's money. */
const TEST_QUESTION_COUNT = 3;

type TestResult = {
  questions: Question[];
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
  rejected: number;
};

/**
 * A generated question rendered exactly as the player would draw it.
 *
 * Reuses the registry's AnswerView with a synthetic pre-revealed grade — the
 * same trick the question-detail screen uses. Showing raw JSON would prove the
 * request worked; showing the real component proves the output is something the
 * app can actually put in front of someone.
 */
function GeneratedQuestion({ question }: { question: Question }) {
  const AnswerView = getAnswerView(question.format);
  const revealed: Grade = useMemo(
    () => ({ status: 'graded', outcome: 'correct', score: 1 }),
    [],
  );

  return (
    <View style={styles.generated}>
      <Badge label={getQuestionLogic(question.format).label} />
      <Text style={styles.prompt}>{question.prompt}</Text>
      <AnswerView
        question={question}
        answer={null as never}
        onChange={() => undefined}
        grade={revealed}
        disabled
      />
      <Text style={styles.explanation}>{question.explanation}</Text>
    </View>
  );
}

function ProviderCard({ provider }: { provider: LlmProviderDefinition }) {
  const keyStatus = useKeyStatus(provider.id);
  const model = useModelFor(provider.id);

  const [draftKey, setDraftKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveApiKey(provider.id, draftKey);
      // Cleared immediately: the value is in the Keychain now, and there is no
      // reason for it to stay in component state or on screen.
      setDraftKey('');
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  }, [provider.id, draftKey]);

  const remove = useCallback(async () => {
    setResult(null);
    setError(null);
    await removeApiKey(provider.id).catch(setError);
  }, [provider.id]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const apiKey = await readApiKey(provider.id);
      if (!apiKey) throw new Error('Save an API key first.');

      const outcome = await generateFromNote({
        note: getSampleNote(),
        path: SAMPLE_NOTE_PATH,
        sourceId: 'sample',
        provider,
        apiKey,
        model: model || provider.defaultModel,
        count: TEST_QUESTION_COUNT,
      });

      setResult({
        questions: outcome.questions,
        usage: outcome.usage,
        elapsedMs: outcome.elapsedMs,
        rejected: outcome.rejected.length,
      });
    } catch (caught) {
      setError(caught);
    } finally {
      setTesting(false);
    }
  }, [provider, model]);

  const hasKey = keyStatus === 'set';
  const mismatched = draftKey.trim().length > 0 && !looksLikeKeyFor(provider, draftKey);

  return (
    <Card title={provider.label}>
      {hasKey ? (
        <View style={styles.row}>
          <Badge label="Key saved" tone="success" />
          <Button title="Remove" variant="plain" onPress={() => void remove()} />
        </View>
      ) : null}

      <TextField
        label={hasKey ? 'Replace key' : 'API key'}
        placeholder={provider.keyHint}
        value={draftKey}
        onChangeText={setDraftKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        // A warning, never a block: prefixes are a convention, not a guarantee,
        // and the Test button gives the real answer.
        error={mismatched ? `That doesn't look like an ${provider.label} key — ${provider.keyHint.toLowerCase()}.` : undefined}
      />

      <View style={styles.row}>
        <Button
          title={saving ? 'Saving…' : 'Save key'}
          onPress={() => void save()}
          disabled={draftKey.trim().length === 0}
          loading={saving}
          variant="secondary"
        />
        <Button
          title="Get a key"
          variant="plain"
          onPress={() => void WebBrowser.openBrowserAsync(provider.consoleUrl)}
        />
      </View>

      <SectionHeader title="Model" />
      <ChipGroup scroll>
        {provider.models.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={model === option.id}
            onPress={() => setModel(provider.id, option.id)}
          />
        ))}
      </ChipGroup>
      <TextField
        value={model}
        onChangeText={(text) => setModel(provider.id, text)}
        placeholder={provider.defaultModel}
        size="compact"
      />
      <Text style={styles.hint}>
        {provider.models.find((option) => option.id === model)?.note ??
          'Editable — provider model names change often.'}
      </Text>

      <Button
        title={testing ? 'Generating…' : 'Test'}
        onPress={() => void runTest()}
        disabled={!hasKey || testing}
        loading={testing}
      />

      {error ? <ErrorBanner error={error} onRetry={() => void runTest()} /> : null}

      {result ? (
        <View style={styles.result}>
          <Text style={styles.resultMeta}>
            {result.questions.length} question{result.questions.length === 1 ? '' : 's'} in{' '}
            {(result.elapsedMs / 1000).toFixed(1)}s · {result.usage.inputTokens.toLocaleString()} in /{' '}
            {result.usage.outputTokens.toLocaleString()} out tokens
            {result.rejected > 0 ? ` · ${result.rejected} unusable` : ''}
          </Text>
          {result.questions.map((question) => (
            <GeneratedQuestion key={question.id} question={question} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Emptying the bank so it can be rebuilt from scratch.
 *
 * Clears coverage in the same action, which is the part that is easy to get
 * wrong: deleting the questions alone leaves every note marked "already
 * covered", so the next generation run finds nothing to do and the bank stays
 * empty with no explanation.
 */
function QuestionBankSection() {
  const questions = useQuestions();
  const coveredNotes = coverageStore.useSelector((state) => Object.keys(state.entries).length);

  const confirm = useCallback(() => {
    Alert.alert(
      'Delete all questions?',
      `This removes ${questions.length} question${questions.length === 1 ? '' : 's'}, along with your review history and any quiz in progress. Your notes and quizzes are untouched, and generation will rebuild the bank from scratch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const { removed } = clearQuestionBank();
            // Without this the ledger still says every note is covered.
            clearAllCoverage();
            Alert.alert(
              'Bank cleared',
              `${removed} question${removed === 1 ? '' : 's'} deleted. Generate again to rebuild it.`,
            );
          },
        },
      ],
    );
  }, [questions.length]);

  return (
    <Card title="Question bank">
      <Text style={styles.hint}>
        {questions.length} question{questions.length === 1 ? '' : 's'} · {coveredNotes} note
        {coveredNotes === 1 ? '' : 's'} covered
      </Text>
      <Text style={styles.hint}>
        Useful after changing model or prompt, when the questions already in the bank were made
        under the old one.
      </Text>
      <Button
        title="Delete all questions"
        variant="destructive"
        onPress={confirm}
        disabled={questions.length === 0 && coveredNotes === 0}
      />
    </Card>
  );
}

export default function SettingsScreen() {
  const generatorId = useGeneratorId();
  const providers = listLlmProviders();

  const options = useMemo(
    () => [
      { value: 'mock' as GeneratorId, label: 'Mock' },
      ...providers.map((provider) => ({ value: provider.id as GeneratorId, label: provider.label })),
    ],
    [providers],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Screen>
        <SectionHeader title="Question generation" />
        <SegmentedControl options={options} value={generatorId} onChange={setGeneratorId} />
        <Text style={styles.hint}>
          {generatorId === 'mock'
            ? 'Mock builds questions from your notes offline, with no API calls. Good for trying the app out; the questions are mechanical.'
            : 'Questions are written by the model from one note at a time.'}
        </Text>

        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}

        {/* Said plainly rather than implied. The no-backend design means the key
            is on the device, and anyone who says otherwise is overselling it. */}
        <Callout
          tone="info"
          title="About your API key"
          message="Keys are stored in the device keychain and sent only to the provider you chose. With no backend, the key lives on this device — anyone with access to an unlocked phone and the right tools could read it. Use a key with a spending limit."
        />

        <QuestionBankSection />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  hint: { ...type.small, color: colors.textMuted },
  result: { gap: spacing.md, marginTop: spacing.sm },
  resultMeta: { ...type.small, color: colors.textMuted },
  generated: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
  },
  prompt: { ...type.bodyStrong, color: colors.text, lineHeight: 22 },
  explanation: { ...type.small, color: colors.textMuted, lineHeight: 18 },
});
