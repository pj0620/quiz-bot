import {
  useCallback,
  useRef,
  useState } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import { Text } from 'react-native';

import { resolveCredentials } from '../../src/features/llm/credentials';
import { generateFromTopic } from '../../src/features/llm/generateFromTopic';
import { getGuidance } from '../../src/features/llm/settings';
import { useGeneratorId } from '../../src/features/llm/useLlm';
import { getQuestionLogic } from '../../src/quiz/questionTypes';
import {
  MAX_PROMPT_CHARS,
  PROMPT_SOURCE_ID,
  promptSlug,
  validatePrompt,
} from '../../src/quiz/promptSource';
import { addQuestions, getQuestions } from '../../src/quiz/store';
import type { Question } from '../../src/quiz/types';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { TextField } from '../../src/ui/components/TextField';
import { colors, themedSheet, type } from '../../src/ui/theme';

/**
 * Generate questions about a subject the reader names, with no note behind it.
 *
 * Deliberately simpler than the note run on the other tab of this route: a
 * subject is ONE request, so there is no plan, no per-note progress and no
 * background resume — a spinner, a cancel, and the results. What is kept from
 * the note flow is the part that matters: questions are saved to the bank the
 * moment they arrive, so nothing paid for can be lost to navigation.
 */

/** Ceilings offered for one ask. Bounded by the same budget as a note part. */
const COUNT_CHOICES = [5, 10, 20] as const;

const EXAMPLES = 'e.g. History of the Whig party, how vaccines work, the Dutch Golden Age';

type RunState =
  | { status: 'idle' }
  | { status: 'running'; subject: string }
  | {
      status: 'finished';
      subject: string;
      added: number;
      duplicates: number;
      questions: Question[];
      usage: { inputTokens: number; outputTokens: number };
    };

/**
 * How many prompts the overview lists before deferring to the bank.
 *
 * The finished state used to render every question IN FULL — answer options,
 * explanations, the lot — which made the one screen with three useful buttons
 * on it several screens long. The full rendering already exists one tap away
 * in the bank browser, so here a glance's worth of prompts is the right size.
 */
const OVERVIEW_PROMPTS = 4;

/** "4 multiple choice · 3 true/false", from the registry's own labels. */
function formatBreakdown(questions: readonly Question[]): string {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const label = getQuestionLogic(question.format).label.toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count]) => `${count} ${label}`).join(' · ');
}

export default function GenerateFromPromptScreen() {
  const router = useRouter();
  // Seeded from a deep link, so "more like this" can arrive pre-filled.
  const params = useLocalSearchParams<{ topic?: string }>();
  const generatorId = useGeneratorId();

  const [subject, setSubject] = useState(typeof params.topic === 'string' ? params.topic : '');
  const [count, setCount] = useState<number>(10);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const validation = validatePrompt(subject);
  const running = run.status === 'running';

  const start = useCallback(async () => {
    const checked = validatePrompt(subject);
    if (!checked.ok || generatorId === 'mock') return;

    setError(null);
    setRun({ status: 'running', subject: checked.prompt });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const credentials = await resolveCredentials(generatorId);

      /*
        What this subject already has in the bank, so asking twice extends the
        set instead of re-treading it. Matched by slug rather than raw text, so
        "whig party" and "Whig Party" count as the same ask.
      */
      const alreadyAsked = getQuestions()
        .filter(
          (question) =>
            question.sourceId === PROMPT_SOURCE_ID &&
            promptSlug(question.provenance.noteTitle ?? '') === checked.slug,
        )
        .map((question) => question.prompt);

      const outcome = await generateFromTopic({
        subject: checked.prompt,
        slug: checked.slug,
        count,
        ...(alreadyAsked.length > 0 ? { alreadyAsked } : {}),
        provider: credentials.provider,
        apiKey: credentials.apiKey,
        model: credentials.model,
        guidance: getGuidance(),
        signal: controller.signal,
      });

      // Saved immediately, before anything is shown — the same rule the note
      // run follows. Ids are deterministic, so re-asks dedupe here.
      const { added } = addQuestions(outcome.questions);

      setRun({
        status: 'finished',
        subject: checked.prompt,
        added,
        duplicates: outcome.questions.length - added,
        questions: outcome.questions,
        usage: outcome.usage,
      });
    } catch (caught) {
      // Cancelling is the user's own action, not something to report back.
      if (!controller.signal.aborted) setError(caught);
      setRun({ status: 'idle' });
    } finally {
      abortRef.current = null;
    }
  }, [subject, count, generatorId]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setRun({ status: 'idle' });
    setError(null);
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: 'Ask for questions' }} />
      <Screen>
        {run.status !== 'finished' ? (
          <>
            <Card title="What should the questions be about?">
              <TextField
                value={subject}
                onChangeText={setSubject}
                placeholder={EXAMPLES}
                maxLength={MAX_PROMPT_CHARS}
                autoCapitalize="sentences"
                autoCorrect
                editable={!running}
              />
              <Text style={styles.hint}>
                Name a subject and the model writes a set of questions on it — no notes needed.
                They join your bank under a topic of their own, so you can quiz on them like
                anything else.
              </Text>
              {subject.trim().length > 0 && !validation.ok ? (
                <Text style={styles.warn}>{validation.reason}</Text>
              ) : null}
            </Card>

            <SectionHeader title="Up to how many" />
            <ChipGroup scroll>
              {COUNT_CHOICES.map((value) => (
                <Chip
                  key={value}
                  label={String(value)}
                  selected={count === value}
                  onPress={() => setCount(value)}
                />
              ))}
            </ChipGroup>

            {generatorId === 'mock' ? (
              <Callout
                tone="warning"
                title="Needs a real model"
                message="Mock builds questions from your notes offline, and there is no note here to build from. Pick a provider in Settings first."
              />
            ) : null}
          </>
        ) : null}

        {running ? (
          <Card title="Writing questions">
            <Text style={styles.stat}>“{run.status === 'running' ? run.subject : ''}”</Text>
            <Text style={styles.hint}>
              One request, usually well under a minute. Anything generated is saved to your bank
              the moment it arrives.
            </Text>
          </Card>
        ) : null}

        {run.status === 'finished' ? (
          <>
            {/*
              A short overview, not a gallery. Everything here fits one screen:
              what was made, its shape, and a taste of it — the questions
              themselves live in the bank, where "See them" lands pre-filtered.
            */}
            <Card title="Done">
              <Text style={styles.stat}>
                {run.added} question{run.added === 1 ? '' : 's'} added on “{run.subject}”
                {run.duplicates > 0 ? ` · ${run.duplicates} already in your bank` : ''}
              </Text>
              {run.questions.length > 0 ? (
                <Text style={styles.hint}>{formatBreakdown(run.questions)}</Text>
              ) : null}

              {run.questions.slice(0, OVERVIEW_PROMPTS).map((question) => (
                <Text key={question.id} style={styles.promptLine} numberOfLines={1}>
                  ·  {question.prompt}
                </Text>
              ))}
              {run.questions.length > OVERVIEW_PROMPTS ? (
                <Text style={styles.hint}>
                  …and {run.questions.length - OVERVIEW_PROMPTS} more
                </Text>
              ) : null}

              {run.usage.inputTokens > 0 || run.usage.outputTokens > 0 ? (
                <Text style={styles.hint}>
                  {run.usage.inputTokens.toLocaleString()} in /{' '}
                  {run.usage.outputTokens.toLocaleString()} out tokens
                </Text>
              ) : null}
            </Card>

            <Button
              title="See them in the bank"
              onPress={() => {
                // Pre-filtered to this ask's topic, where the full questions
                // render properly — the job the inline previews used to do.
                const topic = run.questions[0]?.topics[0];
                if (topic) router.push({ pathname: '/questions', params: { topic } });
                else router.push('/questions');
              }}
            />
            <Button title="Ask for more on this" variant="secondary" onPress={() => void start()} />
            <Button title="Ask about something else" variant="plain" onPress={reset} />
          </>
        ) : null}

        {error ? <ErrorBanner error={error} onRetry={() => void start()} /> : null}

        {running ? (
          <Button title="Cancel" variant="destructive" onPress={cancel} />
        ) : run.status === 'idle' ? (
          <Button
            title="Write questions"
            onPress={() => void start()}
            disabled={!validation.ok || generatorId === 'mock'}
          />
        ) : null}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  stat: { ...type.bodyStrong, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  warn: { ...type.small, color: colors.warning },
  promptLine: { ...type.small, color: colors.text, lineHeight: 18 },
}));
