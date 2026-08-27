import {
  useCallback,
  useMemo,
  useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Alert,
  Switch,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { looksLikeKeyFor, type LlmProviderDefinition } from '../../src/features/llm/contract';
import { readApiKey } from '../../src/features/llm/auth/secureKeyStore';
import { generateFromNote } from '../../src/features/llm/generateFromNote';
import { getLlmProvider, listLlmProviders } from '../../src/features/llm/registry';
import { getSampleNote, SAMPLE_NOTE_PATH } from '../../src/features/llm/sampleNote';
import {
  CONCURRENCY_CHOICES,
  MAX_GUIDANCE_CHARS,
  removeApiKey,
  saveApiKey,
  setConcurrency,
  setGeneratorId,
  setGuidance,
  setJudgeId,
  setJudgeModel,
  setModel,
} from '../../src/features/llm/settings';
import {
  useConcurrency,
  useGeneratorId,
  useGuidance,
  useJudgeId,
  useJudgeModelFor,
  useKeyStatus,
  useKeyStatuses,
  useLlmSettings,
  useModelFor,
} from '../../src/features/llm/useLlm';
import type { GeneratorId, JudgeId, LlmProviderId } from '../../src/features/llm/types';
import {
  setSelectionMode,
  useSelectionMode,
  type SelectionMode,
} from '../../src/quiz/preferences';
import { setSubjectEnabled, useEnabledSubjects } from '../../src/quiz/geography/preferences';
import { listMaps } from '../../src/quiz/geography/maps';
import type { GeographySubject } from '../../src/quiz/geography/types';
import { describeCalendarSubjects } from '../../src/quiz/calendar/catalog';
import {
  setCalendarSubjectEnabled,
  useEnabledCalendarSubjects,
} from '../../src/quiz/calendar/preferences';
import {
  clearAllCoverage,
  clearEmptyCoverage,
  coverageStore,
} from '../../src/quiz/generation/coverageStore';
import { getAnswerView, getQuestionLogic } from '../../src/quiz/questionTypes';
import { clearQuestionBank } from '../../src/quiz/store';
import {
  addTheme,
  removeTheme,
  setWordsPerBatch,
  useVocabThemes,
  useWordsPerBatch,
  WORDS_PER_BATCH_CHOICES,
} from '../../src/quiz/vocab/preferences';
import { useQuestions } from '../../src/quiz/useQuiz';
import type { Grade, Question } from '../../src/quiz/types';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { Disclosure } from '../../src/ui/components/Disclosure';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { ListRow } from '../../src/ui/components/ListRow';
import { Screen } from '../../src/ui/components/Screen';
import { SegmentedControl } from '../../src/ui/components/SegmentedControl';
import { TextField } from '../../src/ui/components/TextField';
import { colors, spacing, themedSheet, themes, type, useThemeName } from '../../src/ui/theme';

/** How many questions the test asks for. Small — this runs on the user's money. */
const TEST_QUESTION_COUNT = 3;

type TestResult = {
  questions: Question[];
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
  rejected: number;
};

/**
 * The short name for a model id, when there is one.
 *
 * Summaries read "Anthropic · Sonnet 5" rather than "claude-sonnet-5": on a
 * collapsed row the point is to be recognised at a glance, and the full id is
 * one tap away in the field that owns it.
 */
function modelLabel(providerId: LlmProviderId, model: string): string {
  const provider = getLlmProvider(providerId);
  const preset = provider.models.find((option) => option.id === model);
  return `${provider.label} · ${preset?.label ?? (model || provider.defaultModel)}`;
}

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

/**
 * Presets plus a free-text field, for one provider's model.
 *
 * Shared by the writer and the judge rather than written twice, because the
 * choice is identical in both places — the only difference is which setting the
 * answer lands in, which is what `onChange` is for.
 */
function ModelChoice({
  provider,
  model,
  onChange,
}: {
  provider: LlmProviderDefinition;
  model: string;
  onChange: (model: string) => void;
}) {
  return (
    <>
      <ChipGroup scroll>
        {provider.models.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={model === option.id}
            onPress={() => onChange(option.id)}
          />
        ))}
      </ChipGroup>
      <TextField
        value={model}
        onChangeText={onChange}
        placeholder={provider.defaultModel}
        size="compact"
      />
      <Text style={styles.hint}>
        {provider.models.find((option) => option.id === model)?.note ??
          'Editable — provider model names change often.'}
      </Text>
    </>
  );
}

/*
  The two pickers below are split into their own components ONLY so the model
  hooks have a provider id to run against. Reading the model for "whichever
  provider is selected" from a parent that may have none selected would mean a
  conditional hook; rendering a component conditionally is the same thing done
  legally.
*/
function WriterModelChoice({ providerId }: { providerId: LlmProviderId }) {
  const model = useModelFor(providerId);
  return (
    <ModelChoice
      provider={getLlmProvider(providerId)}
      model={model}
      onChange={(next) => setModel(providerId, next)}
    />
  );
}

function JudgeModelChoice({ providerId }: { providerId: LlmProviderId }) {
  const model = useJudgeModelFor(providerId);
  return (
    <ModelChoice
      provider={getLlmProvider(providerId)}
      model={model}
      onChange={(next) => setJudgeModel(providerId, next)}
    />
  );
}

/**
 * Which model writes questions, and which model marks written answers.
 *
 * One card with two rows because the pairing is the explanation: they are the
 * same kind of choice made twice, and seeing them side by side is what makes it
 * obvious that marking can be cheap while writing is not. Collapsed, each row
 * still answers the question it asks — "Anthropic · Sonnet 5" — so opening one
 * is only ever to change it.
 */
function ModelsCard() {
  const { generatorId, judgeId, models, judgeModels } = useLlmSettings();
  const keyStatus = useKeyStatuses();
  const providers = listLlmProviders();
  const [open, setOpen] = useState<'writer' | 'judge' | null>(null);

  const writerOptions = useMemo(
    () => [
      { value: 'mock' as GeneratorId, label: 'Mock' },
      ...providers.map((provider) => ({
        value: provider.id as GeneratorId,
        label: provider.label,
      })),
    ],
    [providers],
  );

  const judgeOptions = useMemo(
    () => [
      { value: 'match' as JudgeId, label: 'Same' },
      ...providers.map((provider) => ({ value: provider.id as JudgeId, label: provider.label })),
    ],
    [providers],
  );

  const writerValue =
    generatorId === 'mock' ? 'Mock · offline' : modelLabel(generatorId, models[generatorId]);

  const judgeValue =
    judgeId === 'match'
      ? generatorId === 'mock'
        ? 'You mark your own'
        : 'Same as writer'
      : modelLabel(judgeId, judgeModels[judgeId]);

  return (
    <Card title="Models" icon="sparkles" accent="primary">
      <Disclosure
        title="Writes questions"
        value={writerValue}
        open={open === 'writer'}
        onToggle={(next) => setOpen(next ? 'writer' : null)}
      >
        <SegmentedControl options={writerOptions} value={generatorId} onChange={setGeneratorId} />
        {generatorId === 'mock' ? (
          <Text style={styles.hint}>
            Builds questions from your notes offline, with no API calls and no cost. The questions
            are mechanical.
          </Text>
        ) : (
          <>
            <WriterModelChoice providerId={generatorId} />
            {keyStatus[generatorId] === 'missing' ? (
              <Text style={styles.warn}>No key saved — add one below before generating.</Text>
            ) : null}
          </>
        )}
      </Disclosure>

      <Disclosure
        title="Marks written answers"
        value={judgeValue}
        divider
        open={open === 'judge'}
        onToggle={(next) => setOpen(next ? 'judge' : null)}
      >
        <SegmentedControl options={judgeOptions} value={judgeId} onChange={setJudgeId} />
        {judgeId === 'match' ? (
          <Text style={styles.hint}>
            {generatorId === 'mock'
              ? 'Mock cannot mark, so written answers come back to you. Pick a provider to have them marked even while questions are written offline.'
              : 'Marked by whatever writes the questions. Pick a provider to mark with something cheaper.'}
          </Text>
        ) : (
          <>
            <JudgeModelChoice providerId={judgeId} />
            {keyStatus[judgeId] === 'missing' ? (
              <Text style={styles.warn}>
                No key saved — written answers will come back to you to grade until there is one.
              </Text>
            ) : null}
          </>
        )}
        <Text style={styles.hint}>
          Only written answers are marked this way, and you can always overrule a verdict.
        </Text>
      </Disclosure>
    </Card>
  );
}

/**
 * One provider's key: saving it, replacing it, and proving it works.
 *
 * Collapsed to a row with a status badge, because a key is set once and then
 * never touched — while still being the first thing to check when generation
 * stops working, which is why the badge is on the closed row.
 */
function ProviderKeyRow({
  provider,
  divider,
  open,
  onToggle,
}: {
  provider: LlmProviderDefinition;
  divider: boolean;
  open: boolean;
  onToggle: (next: boolean) => void;
}) {
  const keyStatus = useKeyStatus(provider.id);
  const model = useModelFor(provider.id);
  // Sent with the test too, so what Test shows is what a run would actually
  // produce — a test that ignored the notes would be testing a prompt nobody
  // uses, which is exactly the wrong thing to build confidence on.
  const guidance = useGuidance();

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
        guidance,
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
  }, [provider, model, guidance]);

  const hasKey = keyStatus === 'set';
  const mismatched = draftKey.trim().length > 0 && !looksLikeKeyFor(provider, draftKey);

  return (
    <Disclosure
      title={provider.label}
      icon={provider.icon}
      divider={divider}
      open={open}
      onToggle={onToggle}
      accessory={
        <View style={styles.badgeWrap}>
          <Badge
            label={hasKey ? 'Key saved' : 'No key'}
            tone={hasKey ? 'success' : 'neutral'}
          />
        </View>
      }
    >
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
        {hasKey ? <Button title="Remove" variant="plain" onPress={() => void remove()} /> : null}
      </View>

      <Button
        title={testing ? 'Generating…' : `Test — write ${TEST_QUESTION_COUNT} questions`}
        onPress={() => void runTest()}
        disabled={!hasKey || testing}
        loading={testing}
        variant="secondary"
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
    </Disclosure>
  );
}

function KeysCard() {
  const providers = listLlmProviders();
  const [open, setOpen] = useState<LlmProviderId | null>(null);

  return (
    <Card
      title="API keys"
      icon="key-outline"
      accent="teal"
      /* Said plainly rather than implied. The no-backend design means the key is
         on the device, and anyone who says otherwise is overselling it. */
      footer={
        <Text style={styles.hint}>
          Keys are held in the device keychain and sent only to the provider they belong to. With no
          backend they live on this phone, so use a key with a spending limit.
        </Text>
      }
    >
      {providers.map((provider, index) => (
        <ProviderKeyRow
          key={provider.id}
          provider={provider}
          divider={index > 0}
          open={open === provider.id}
          onToggle={(next) => setOpen(next ? provider.id : null)}
        />
      ))}
    </Card>
  );
}

const GUIDANCE_PLACEHOLDER = `Keep questions short and about the big picture.
Ask why something happened more often than when.
I'm a fan of history, not a historian — skip the fine detail.`;

/** Shown once the field is close enough to the cap for it to matter. */
const COUNTDOWN_FROM = 250;

/**
 * How a run behaves: how many notes at once, and the reader's own instructions.
 *
 * `concurrency` is worth exposing rather than fixing because the right number
 * is a property of the account and not of the app: a run is almost entirely
 * spent waiting on the provider, so more lanes is close to linearly faster —
 * right up until the provider's rate limit, which differs by tier. And the
 * request rate is a MULTIPLE of this number, since a long note is split across
 * several calls.
 *
 * The guidance field is the only control on this screen over the questions
 * themselves; everything else is about cost or plumbing. It is written straight
 * to the store on each keystroke rather than held behind a Save button — there
 * is nothing to validate and nothing to fail, and a settings field that
 * silently discards what you typed because you navigated away is a worse
 * bargain than a write per character.
 */
function GenerationCard() {
  const concurrency = useConcurrency();
  const guidance = useGuidance();
  const generatorId = useGeneratorId();
  const remaining = MAX_GUIDANCE_CHARS - guidance.length;
  const firstLine = guidance.trim().split('\n')[0];

  return (
    <Card title="Generation" icon="options-outline" accent="violet">
      <View style={styles.inlineRow}>
        <Text style={styles.rowLabel}>Notes at a time</Text>
        <ChipGroup>
          {CONCURRENCY_CHOICES.map((value) => (
            <Chip
              key={value}
              label={String(value)}
              selected={concurrency === value}
              onPress={() => setConcurrency(value)}
            />
          ))}
        </ChipGroup>
      </View>
      <Text style={styles.hint}>
        {concurrency === 1
          ? 'Slowest, and the least likely to be rate limited.'
          : `Ten notes take about as long as ${Math.ceil(10 / concurrency)} would. Lower it if you start seeing rate-limit errors.`}
      </Text>

      <Disclosure
        title="Your question notes"
        value={firstLine || 'None'}
        divider
      >
        <Text style={styles.hint}>
          Added to the end of every generation prompt, where it outranks the app's own instructions.
          Say how you want questions pitched — how long, how hard, what to leave alone.
        </Text>

        <TextField
          value={guidance}
          onChangeText={setGuidance}
          placeholder={GUIDANCE_PLACEHOLDER}
          multiline
          maxLength={MAX_GUIDANCE_CHARS}
          // Prose, not an identifier — the screen's other fields are keys and
          // model names, which is why the component defaults the other way.
          autoCapitalize="sentences"
          autoCorrect
        />

        <Text style={styles.hint}>
          {remaining <= COUNTDOWN_FROM ? `${remaining} characters left. ` : ''}
          {generatorId === 'mock'
            ? 'Mock builds questions offline from templates and ignores this — pick a provider for it to take effect.'
            : 'Only affects questions generated from now on.'}
        </Text>
      </Disclosure>
    </Card>
  );
}

/**
 * How a quiz picks which questions to ask.
 *
 * Worth a setting rather than a fixed behaviour because the two modes serve
 * genuinely different goals, and neither is wrong. Spaced repetition is trying
 * to make things stick with the fewest reviews, which means deliberately NOT
 * showing you most of your bank on any given day. Even picking is trying to
 * give you a fair sample of everything you have written down.
 */
function SelectionModeCard() {
  const mode = useSelectionMode();

  return (
    <Card title="Picking questions" icon="shuffle-outline" accent="amber">
      <SegmentedControl
        options={[
          { value: 'spaced' as SelectionMode, label: 'Spaced' },
          { value: 'even' as SelectionMode, label: 'Even' },
        ]}
        value={mode}
        onChange={setSelectionMode}
      />
      <Text style={styles.hint}>
        {mode === 'spaced'
          ? 'Half unseen questions, half reviews that have come due — most overdue first. Anything answered correctly recently is held back until the schedule brings it round again.'
          : 'Every matching question has the same chance of coming up. Nothing is held back and nothing is prioritised; answers are still recorded.'}
      </Text>
    </Card>
  );
}

/**
 * Which geography subjects are switched on.
 *
 * Off by default, and this is the screen where that gets undone. Geography is
 * the app's only DERIVED material — the fifty states are a fixed set a function
 * can enumerate, so its questions are generated procedurally at session start
 * rather than written by a model and stored (see `src/quiz/geography/types.ts`).
 *
 * That makes the toggle unusually consequential for a settings row: switching a
 * subject on adds its questions to every quiz that matches on topic, including
 * the Daily quiz, without anything being downloaded or generated. Switching it
 * off removes them again just as immediately. Nothing is lost either way —
 * review history is keyed to question ids that are stable across both.
 *
 * A `Switch` rather than the `ChoiceRow` the player uses: these are three
 * independent toggles, and `ChoiceRow` announces itself to screen readers as a
 * radio option, which would be a lie about what these do.
 */
function GeographyCard() {
  const enabled = useEnabledSubjects();

  return (
    <Card title="Geography" icon="globe-outline" accent="teal">
      <Text style={styles.hint}>
        Questions are built from built-in maps — tap a region, or name one from its outline.
        Nothing is generated and no key is needed.
      </Text>
      {listMaps().map((map) => {
        const subject = map.id as GeographySubject;
        const on = enabled.includes(subject);
        return (
          <View key={map.id} style={styles.geoRow}>
            <View style={styles.geoText}>
              <Text style={styles.geoLabel}>{map.label}</Text>
              <Text style={styles.geoCount}>{map.regions.length} regions</Text>
            </View>
            <Switch
              value={on}
              onValueChange={(next) => setSubjectEnabled(subject, next)}
              accessibilityLabel={map.label}
            />
          </View>
        );
      })}
    </Card>
  );
}

/**
 * Which calendar subjects are switched on.
 *
 * The second derived catalog, and this card is its twin of `GeographyCard`
 * above — same off-by-default contract, same consequence when toggled:
 * switching a subject on adds its questions to every quiz that matches on
 * topic immediately, with nothing downloaded or generated, and switching it
 * off removes them just as immediately with no history lost.
 */
function CalendarCard() {
  const enabled = useEnabledCalendarSubjects();

  return (
    <Card title="Calendar" icon="calendar-outline" accent="teal">
      <Text style={styles.hint}>
        Month numbers and order, days of the week, the seasons, and fixed-date
        holidays. Nothing is generated and no key is needed.
      </Text>
      {describeCalendarSubjects().map((subject) => {
        const on = enabled.includes(subject.id);
        return (
          <View key={subject.id} style={styles.geoRow}>
            <View style={styles.geoText}>
              <Text style={styles.geoLabel}>{subject.label}</Text>
              <Text style={styles.geoCount}>{subject.count} questions</Text>
            </View>
            <Switch
              value={on}
              onValueChange={(next) => setCalendarSubjectEnabled(subject.id, next)}
              accessibilityLabel={subject.label}
            />
          </View>
        );
      })}
    </Card>
  );
}

/**
 * Where suggested words come from.
 *
 * A theme is the reader's own description of the words they want, sent to the
 * model as written. Deliberately the only steering control here: a separate
 * "level" dial would say the same thing a second way — "GRE-level words" is a
 * level expressed as a theme — and two overlapping controls pull against each
 * other inside one prompt.
 */
function VocabCard() {
  const themes = useVocabThemes();
  const wordsPerBatch = useWordsPerBatch();
  const [draft, setDraft] = useState('');

  const add = useCallback(() => {
    if (addTheme(draft)) setDraft('');
  }, [draft]);

  const confirmRemove = useCallback((id: string, label: string) => {
    Alert.alert(`Remove "${label}"?`, 'Words you already added are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeTheme(id) },
    ]);
  }, []);

  return (
    <Card title="Vocabulary" icon="book-outline" accent="success">
      <Disclosure
        title="Word suggestions"
        value={`${themes.length} theme${themes.length === 1 ? '' : 's'} · ${wordsPerBatch} at a time`}
      >
        <Text style={styles.hint}>
          Themes steer what "Suggest words" comes back with. You pick one each time you ask.
        </Text>

        {themes.map((theme) => (
          <ListRow
            key={theme.id}
            title={theme.label}
            subtitle={
              theme.kind === 'notes'
                ? 'Draws on the subjects already in your bank'
                : theme.builtin
                  ? 'Built in'
                  : undefined
            }
            // Built-ins are editable but not deletable, exactly as built-in
            // quizzes are — an empty list would leave nothing to suggest from.
            {...(theme.builtin
              ? {}
              : { onPress: () => confirmRemove(theme.id, theme.label) })}
            accessory={
              theme.builtin ? undefined : (
                <Ionicons name="close-circle-outline" size={20} color={colors.textFaint} />
              )
            }
          />
        ))}

        <TextField
          value={draft}
          onChangeText={setDraft}
          placeholder="e.g. legal Latin, words for weather"
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Button title="Add a theme" variant="secondary" onPress={add} disabled={!draft.trim()} />

        <View style={styles.inlineRow}>
          <Text style={styles.rowLabel}>Words per suggestion</Text>
          <ChipGroup>
            {WORDS_PER_BATCH_CHOICES.map((count) => (
              <Chip
                key={count}
                label={String(count)}
                selected={wordsPerBatch === count}
                onPress={() => setWordsPerBatch(count)}
              />
            ))}
          </ChipGroup>
        </View>
      </Disclosure>
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
function QuestionBankCard() {
  const questions = useQuestions();
  const coveredNotes = coverageStore.useSelector((state) => Object.keys(state.entries).length);
  const emptyNotes = coverageStore.useSelector(
    (state) =>
      Object.values(state.entries).filter(
        (entry) => entry.generatedAt > 0 && entry.questionCount === 0,
      ).length,
  );

  /*
    Retrying only the notes that came back empty.

    A note read for nothing is marked covered and never looked at again, which
    is right when the note really is a page of screenshots and wrong when the
    reason was a rule of ours being too strict. Clearing the whole ledger would
    reach those notes by re-generating the entire vault at full price.
  */
  const retryEmpty = useCallback(() => {
    Alert.alert(
      `Retry ${emptyNotes} note${emptyNotes === 1 ? '' : 's'}?`,
      'These were read but produced no questions, so they are marked covered and skipped. Forgetting that lets the next run read them again. Notes that really have nothing in them will simply come back empty a second time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry them',
          onPress: () => {
            const removed = clearEmptyCoverage();
            Alert.alert(
              'Ready to retry',
              `${removed} note${removed === 1 ? '' : 's'} will be read again on the next run.`,
            );
          },
        },
      ],
    );
  }, [emptyNotes]);

  const confirm = useCallback(() => {
    Alert.alert(
      'Delete all questions?',
      `This removes ${questions.length} question${questions.length === 1 ? '' : 's'}, along with your review history and any quiz in progress. Your notes and quizzes are untouched, and generation will rebuild the bank from scratch. Your word list is kept, so vocabulary questions can be written again.`,
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
    <Card
      title="Question bank"
      icon="library-outline"
      accent="danger"
      titleAccessory={
        <Text style={styles.hint}>
          {questions.length} question{questions.length === 1 ? '' : 's'} · {coveredNotes} note
          {coveredNotes === 1 ? '' : 's'}
        </Text>
      }
    >
      {emptyNotes > 0 ? (
        <>
          <Text style={styles.hint}>
            {emptyNotes} note{emptyNotes === 1 ? '' : 's'} produced no questions and{' '}
            {emptyNotes === 1 ? 'is' : 'are'} being skipped. If that looks wrong, read{' '}
            {emptyNotes === 1 ? 'it' : 'them'} again.
          </Text>
          <Button
            title={`Retry ${emptyNotes} empty note${emptyNotes === 1 ? '' : 's'}`}
            variant="secondary"
            onPress={retryEmpty}
          />
        </>
      ) : null}

      <Button
        title="Delete all questions"
        variant="destructive"
        onPress={confirm}
        disabled={questions.length === 0 && coveredNotes === 0}
      />
      <Text style={styles.hint}>
        Useful after changing model or prompt, when what's in the bank was written under the old one.
      </Text>
    </Card>
  );
}

/** Where the app's look is chosen. One row — the picker is its own screen. */
function AppearanceCard() {
  const router = useRouter();
  const themeName = useThemeName();

  return (
    <Card title="Appearance" icon="color-palette-outline" accent="violet">
      <ListRow
        title={themes[themeName].label}
        subtitle={themes[themeName].description}
        onPress={() => router.push('/settings/theme')}
        showChevron
      />
    </Card>
  );
}

export default function SettingsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Screen>
        <AppearanceCard />
        <ModelsCard />
        <KeysCard />
        <GenerationCard />
        <SelectionModeCard />
        <GeographyCard />
        <CalendarCard />
        <VocabCard />
        <QuestionBankCard />
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  // A label and its controls on one line, which is what buys back the vertical
  // space a stacked heading-over-chips layout was spending.
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  rowLabel: { ...type.small, color: colors.text, fontWeight: '600' },
  hint: { ...type.small, color: colors.textMuted },
  geoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  geoText: { flex: 1, gap: 2 },
  geoLabel: { ...type.body, color: colors.text },
  geoCount: { ...type.small, color: colors.textFaint },
  warn: { ...type.small, color: colors.warning },
  // Keeps the badge from stretching, so the title still owns the row's width.
  badgeWrap: { flex: 1, alignItems: 'flex-end' },
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
}));
