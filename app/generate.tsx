import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useGeneratorId } from '../src/features/llm/useLlm';
import { getCoverage } from '../src/quiz/generation/coverageStore';
import { pollAllSources, type RunProgress } from '../src/quiz/generation/poller';
import { foldersOf, selectNotes, toCandidates, type NoteCandidate } from '../src/quiz/generation/selectNotes';
import { getSourceType } from '../src/sources/registry';
import { useSources } from '../src/sources/useSources';
import { Button } from '../src/ui/components/Button';
import { Callout } from '../src/ui/components/Callout';
import { Card } from '../src/ui/components/Card';
import { Chip, ChipGroup } from '../src/ui/components/Chip';
import { EmptyState } from '../src/ui/components/EmptyState';
import { ErrorBanner } from '../src/ui/components/ErrorBanner';
import { LoadingBlock } from '../src/ui/components/LoadingBlock';
import { ProgressBar } from '../src/ui/components/ProgressBar';
import { Screen } from '../src/ui/components/Screen';
import { SectionHeader } from '../src/ui/components/SectionHeader';
import { colors, spacing, type } from '../src/ui/theme';

const TARGETS = [10, 25, 50];

/**
 * How many notes a target is allowed to consume.
 *
 * The cost ceiling. Each note is one provider request plus one model call, so
 * without a cap a target over short notes could run a long time and spend real
 * money. Derived from the target rather than fixed so a small run stays small.
 */
function maxNotesFor(target: number): number {
  return Math.min(20, Math.max(3, Math.ceil(target / 3)));
}

type Survey = {
  candidates: NoteCandidate[];
  folders: string[];
  uncovered: number;
  truncated: boolean;
};

type RunRow = {
  key: string;
  title: string;
  count: number;
  error?: string;
};

export default function GenerateScreen() {
  const router = useRouter();
  const sources = useSources();
  const generatorId = useGeneratorId();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [surveyError, setSurveyError] = useState<unknown>(null);

  const [target, setTarget] = useState(25);
  const [folders, setFolders] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RunRow[]>([]);
  const [added, setAdded] = useState(0);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });
  const [runError, setRunError] = useState<unknown>(null);
  const [finished, setFinished] = useState(false);

  const controller = useRef<AbortController | null>(null);

  /**
   * One tree request per source, before anything is spent.
   *
   * Knowing how much is left to cover is what makes the run's size a real
   * decision rather than a guess, and it costs nothing but a listing.
   */
  const surveySources = useCallback(async () => {
    setSurveyError(null);
    try {
      const candidates: NoteCandidate[] = [];
      let truncated = false;

      for (const source of sources) {
        const listing = await getSourceType(source).provider.listFiles(source);
        candidates.push(...toCandidates(source.id, listing.files));
        truncated = truncated || listing.truncated;
      }

      const { counts } = selectNotes({
        candidates,
        coverage: getCoverage(),
        limit: candidates.length,
      });

      setSurvey({
        candidates,
        folders: foldersOf(candidates),
        uncovered: counts.new + counts.changed,
        truncated,
      });
    } catch (error) {
      setSurveyError(error);
    }
  }, [sources]);

  useEffect(() => {
    void surveySources();
  }, [surveySources]);

  const start = useCallback(async () => {
    controller.current = new AbortController();
    setRunning(true);
    setFinished(false);
    setRows([]);
    setAdded(0);
    setUsage({ inputTokens: 0, outputTokens: 0 });
    setRunError(null);

    try {
      const result = await pollAllSources({
        targetQuestions: target,
        maxNotes: maxNotesFor(target),
        folders: folders.length ? folders : undefined,
        signal: controller.current.signal,
        onProgress: ({ event, addedSoFar }: RunProgress) => {
          setRows((current) => [
            ...current,
            {
              key: `${event.path}-${current.length}`,
              title: event.noteTitle,
              count: event.questions.length,
              error: event.error?.message,
            },
          ]);
          setAdded(addedSoFar);
        },
      });

      setUsage(result.usage);
      if (result.errors.length > 0) setRunError(new Error(result.errors[0].message));
    } catch (error) {
      setRunError(error);
    } finally {
      setRunning(false);
      setFinished(true);
      controller.current = null;
      // The ledger moved, so the "left to cover" figure is now stale.
      void surveySources();
    }
  }, [target, folders, surveySources]);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  const toggleFolder = useCallback((folder: string) => {
    setFolders((current) =>
      current.includes(folder) ? current.filter((entry) => entry !== folder) : [...current, folder],
    );
  }, []);

  const notesCap = maxNotesFor(target);
  const progress = useMemo(() => Math.min(1, rows.length / notesCap), [rows.length, notesCap]);
  const failures = rows.filter((row) => row.error);

  if (sources.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: 'Generate' }} />
        <Screen>
          <EmptyState
            icon="link-outline"
            title="No sources connected"
            body="Connect a repository of markdown notes first."
            actionTitle="Add a source"
            onAction={() => router.replace('/sources/new')}
          />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Generate', gestureEnabled: !running }} />
      <Screen>
        {surveyError ? (
          <ErrorBanner error={surveyError} onRetry={() => void surveySources()} />
        ) : !survey ? (
          <LoadingBlock message="Looking at your notes…" />
        ) : (
          <Card title="Your notes">
            <Text style={styles.stat}>
              {survey.uncovered} of {survey.candidates.length} notes not yet covered
            </Text>
            {generatorId === 'mock' ? (
              <Text style={styles.hint}>
                Mock is selected, so this run is free — and it ignores coverage, re-reading notes
                every time. Pick a provider in Settings for real questions.
              </Text>
            ) : (
              <Text style={styles.hint}>
                Notes already covered at their current version are skipped, so running again only
                picks up what's new or edited.
              </Text>
            )}
            {survey.truncated ? (
              <Callout
                tone="warning"
                title="Partial listing"
                message="This repository is too large for GitHub to list in one request, so some notes are invisible to generation."
              />
            ) : null}
          </Card>
        )}

        {!running ? (
          <>
            <SectionHeader title="How many questions" />
            <ChipGroup scroll>
              {TARGETS.map((value) => (
                <Chip
                  key={value}
                  label={String(value)}
                  selected={target === value}
                  onPress={() => setTarget(value)}
                />
              ))}
            </ChipGroup>
            <Text style={styles.hint}>
              Stops at {target} questions or {notesCap} notes, whichever comes first
              {generatorId === 'mock' ? '.' : ` — about ${notesCap} model calls.`}
            </Text>

            {survey && survey.folders.length > 1 ? (
              <>
                <SectionHeader title="Folders" />
                <ChipGroup scroll>
                  <Chip label="Everywhere" selected={folders.length === 0} onPress={() => setFolders([])} />
                  {survey.folders.map((folder) => (
                    <Chip
                      key={folder}
                      label={folder}
                      selected={folders.includes(folder)}
                      onPress={() => toggleFolder(folder)}
                    />
                  ))}
                </ChipGroup>
              </>
            ) : null}
          </>
        ) : null}

        {running || finished ? (
          <Card title={running ? 'Generating' : 'Finished'}>
            <ProgressBar value={running ? progress : 1} />
            <Text style={styles.stat}>
              {added} question{added === 1 ? '' : 's'} added from {rows.length} note
              {rows.length === 1 ? '' : 's'}
            </Text>
            {!running && (usage.inputTokens > 0 || usage.outputTokens > 0) ? (
              // Shown so the cost of a run is visible rather than inferred.
              <Text style={styles.hint}>
                {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out tokens
              </Text>
            ) : null}

            <View style={styles.rows}>
              {rows.map((row) => (
                <View key={row.key} style={styles.row}>
                  <Ionicons
                    name={row.error ? 'alert-circle-outline' : 'checkmark-circle'}
                    size={16}
                    color={row.error ? colors.danger : colors.success}
                  />
                  {/*
                    Two lines, because these are full vault filenames now and a
                    single line cuts "Thinking Fast and Slow 11 Anchors.md" down
                    to the part that identifies it least.
                  */}
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {row.title}
                  </Text>
                  <Text style={styles.rowCount}>
                    {row.error ? 'failed' : `${row.count}`}
                  </Text>
                </View>
              ))}
            </View>

            {failures.length > 0 && !running ? (
              <Callout
                tone="warning"
                title={`${failures.length} note${failures.length === 1 ? '' : 's'} produced nothing`}
                message={failures[0].error ?? 'Unknown error'}
              />
            ) : null}
          </Card>
        ) : null}

        {runError ? <ErrorBanner error={runError} onRetry={() => void start()} /> : null}

        {running ? (
          // Questions from completed notes are already saved, so cancelling
          // keeps everything paid for so far.
          <Button title="Cancel" variant="destructive" onPress={cancel} />
        ) : (
          <Button
            title={finished ? 'Generate more' : 'Start'}
            onPress={() => void start()}
            disabled={!survey}
          />
        )}

        {finished && !running && added > 0 ? (
          <Button title="Browse questions" variant="plain" onPress={() => router.push('/questions')} />
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  stat: { ...type.bodyStrong, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  rows: { gap: spacing.xs, marginTop: spacing.sm },
  // Top-aligned so the tick stays level with the first line of a wrapped filename.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowTitle: { ...type.small, color: colors.text, flex: 1 },
  rowCount: { ...type.smallStrong, color: colors.textMuted },
});
