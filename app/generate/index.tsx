import {
  useCallback,
  useEffect,
  useMemo,
  useState } from 'react';
import { Stack,
  useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { useConcurrency, useGeneratorId } from '../../src/features/llm/useLlm';
import { getCoverage } from '../../src/quiz/generation/coverageStore';
import {
  cancelGenerationRun,
  resetGenerationRun,
  runStore,
  startGenerationRun,
  type RunNote,
} from '../../src/quiz/generation/runStore';
import { foldersOf, selectNotes, toCandidates, type NoteCandidate } from '../../src/quiz/generation/selectNotes';
import { getSourceType } from '../../src/sources/registry';
import { useSources } from '../../src/sources/useSources';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../src/ui/components/Chip';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { LoadingBlock } from '../../src/ui/components/LoadingBlock';
import { ProgressBar } from '../../src/ui/components/ProgressBar';
import { RunNoteRow } from '../../src/ui/components/RunNoteRow';
import { Screen } from '../../src/ui/components/Screen';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';

/**
 * The run is sized in NOTES, not questions.
 *
 * It used to ask for a question total, which made sense only while every note
 * produced a fixed five. Now that a note yields as many questions as its
 * material is worth, a question total predicts nothing about how long a run
 * takes or what it costs — where notes predict both, because a note is at least
 * one model request and a long one is several.
 */
const NOTE_CHOICES = [1, 5, 10] as const;

/** Enough to be worth warning about before it starts. */
const LARGE_RUN_NOTES = 15;

type Survey = {
  candidates: NoteCandidate[];
  folders: string[];
  uncovered: number;
  truncated: boolean;
};

function tally(notes: readonly RunNote[]) {
  let settled = 0;
  let failed = 0;
  for (const note of notes) {
    if (note.status === 'pending' || note.status === 'running') continue;
    settled += 1;
    if (note.status === 'failed') failed += 1;
  }
  return { settled, failed };
}

export default function GenerateScreen() {
  const router = useRouter();
  const sources = useSources();
  const generatorId = useGeneratorId();
  const concurrency = useConcurrency();

  /*
    The run lives in a store, not here.

    It costs money and takes minutes, so it must not belong to whichever screen
    happens to be mounted — leaving this screen used to abandon the progress
    display while the requests carried on invisibly. Now this screen is a view
    of the run, and can be left and returned to at any point.
  */
  const run = runStore.use();
  const running = run.status === 'running';
  const showRun = run.status !== 'idle';

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [surveyError, setSurveyError] = useState<unknown>(null);

  /** A note count, or 'all' meaning everything still uncovered. */
  const [noteChoice, setNoteChoice] = useState<number | 'all'>(5);
  const [folders, setFolders] = useState<string[]>([]);

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

  // The ledger moves as a run completes notes, so the "left to cover" figure is
  // stale the moment one finishes. Re-surveyed on the transition out of
  // 'running' rather than on every note, which would be a tree request each.
  useEffect(() => {
    if (run.status === 'finished' || run.status === 'cancelled') void surveySources();
  }, [run.status, surveySources]);

  /**
   * How many notes this run will actually read.
   *
   * 'all' resolves against what the survey found still uncovered, so the number
   * shown is the number of notes that will really be worked on rather than the
   * size of the vault.
   */
  const notesCap = noteChoice === 'all' ? Math.max(1, survey?.uncovered ?? 1) : noteChoice;

  const start = useCallback(() => {
    void startGenerationRun({
      // No question limit: the note count IS the budget now.
      maxNotes: notesCap,
      folders: folders.length ? folders : undefined,
    });
  }, [notesCap, folders]);

  const toggleFolder = useCallback((folder: string) => {
    setFolders((current) =>
      current.includes(folder) ? current.filter((entry) => entry !== folder) : [...current, folder],
    );
  }, []);

  const { settled, failed } = useMemo(() => tally(run.notes), [run.notes]);
  // Against the planned list, which the generator emits before it reads
  // anything — so this is a real fraction rather than a growing tally.
  const progress = run.notes.length === 0 ? 0 : settled / run.notes.length;

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
      {/* Leaving no longer cancels anything, so the back gesture stays enabled
          during a run — the run is in a store and keeps going without us. */}
      <Stack.Screen options={{ title: 'Generate' }} />
      <Screen>
        {surveyError ? (
          <ErrorBanner error={surveyError} onRetry={() => void surveySources()} />
        ) : !survey ? (
          <LoadingBlock message="Looking at your notes…" />
        ) : !showRun ? (
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
        ) : null}

        {!showRun ? (
          <>
            <SectionHeader title="How many notes" />
            <ChipGroup scroll>
              {NOTE_CHOICES.map((value) => (
                <Chip
                  key={value}
                  label={String(value)}
                  selected={noteChoice === value}
                  onPress={() => setNoteChoice(value)}
                />
              ))}
              <Chip
                label={survey ? `All ${survey.uncovered}` : 'All'}
                selected={noteChoice === 'all'}
                onPress={() => setNoteChoice('all')}
              />
            </ChipGroup>
            <Text style={styles.hint}>
              Reads {notesCap} note{notesCap === 1 ? '' : 's'}, newest material first,{' '}
              {concurrency === 1 ? 'one at a time' : `${concurrency} at a time`} — change that in
              Settings.
              {generatorId === 'mock'
                ? ''
                : ' Each one yields as many questions as its content is worth, so a long note takes more than one call.'}
            </Text>

            {/*
              Notes are the unit that costs money, so the only honest warning is
              one sized in notes. Shown before Start rather than after, which is
              the only point at which it can still change the decision.
            */}
            {generatorId !== 'mock' && notesCap >= LARGE_RUN_NOTES ? (
              <Callout
                tone="warning"
                title={`${notesCap} notes is a long run`}
                message="Every note is at least one paid request, and a long one is several. You can leave this screen while it runs, cancel part-way, and keep whatever has already been generated."
              />
            ) : null}

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

        {showRun ? (
          <Card
            title={
              running ? 'Generating' : run.status === 'cancelled' ? 'Cancelled' : 'Finished'
            }
          >
            <ProgressBar value={progress} />
            <Text style={styles.stat}>
              {run.added} question{run.added === 1 ? '' : 's'} added from {settled} of{' '}
              {run.notes.length} note{run.notes.length === 1 ? '' : 's'}
            </Text>
            {running ? (
              <Text style={styles.hint}>
                You can leave this screen — the run keeps going. Leaving the app pauses it, and it
                picks up where it stopped when you come back.
              </Text>
            ) : null}
            {run.usage.inputTokens > 0 || run.usage.outputTokens > 0 ? (
              // Shown so the cost of a run is visible rather than inferred.
              <Text style={styles.hint}>
                {run.usage.inputTokens.toLocaleString()} in / {run.usage.outputTokens.toLocaleString()}{' '}
                out tokens
              </Text>
            ) : null}

            <View style={styles.rows}>
              {run.notes.map((note) => (
                <RunNoteRow key={note.key} note={note} />
              ))}
            </View>

            {failed > 0 && !running ? (
              <Callout
                tone="warning"
                title={`${failed} note${failed === 1 ? '' : 's'} produced nothing`}
                message={
                  run.notes.find((note) => note.status === 'failed')?.error ??
                  'They will be retried on the next run.'
                }
              />
            ) : null}
          </Card>
        ) : null}

        {run.error ? <ErrorBanner error={run.error} onRetry={start} /> : null}

        {running ? (
          // Questions from completed notes are already saved, so cancelling
          // keeps everything paid for so far.
          <Button title="Cancel" variant="destructive" onPress={cancelGenerationRun} />
        ) : showRun ? (
          <Button title="Generate more" onPress={() => resetGenerationRun()} />
        ) : (
          <Button title="Start" onPress={start} disabled={!survey} />
        )}

        {!running && run.added > 0 ? (
          <Button title="Browse questions" variant="plain" onPress={() => router.push('/questions')} />
        ) : null}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  stat: { ...type.bodyStrong, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  rows: { marginTop: spacing.sm },
}));
