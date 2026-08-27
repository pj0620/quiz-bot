import {
  useCallback,
  useEffect,
  useMemo,
  useState } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import { ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { GITHUB } from '../../src/features/github/config';
import { disconnectGitHub, forceRefresh, peekTokenRecord } from '../../src/features/github/auth/tokenManager';
import { isNotePath, noteStem } from '../../src/notes/paths';
import { parseNoteName } from '../../src/notes/noteName';
import { isQuizzable, parseNote, sectionText } from '../../src/notes/parse';
import { clearCoverageForSource } from '../../src/quiz/generation/coverageStore';
import { getSourceType } from '../../src/sources/registry';
import { removeSource, setSourceHealth } from '../../src/sources/store';
import type { FileListing, SourceHealth } from '../../src/sources/types';
import { useSource, useSourceHealth } from '../../src/sources/useSources';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ErrorBanner } from '../../src/ui/components/ErrorBanner';
import { Screen } from '../../src/ui/components/Screen';
import { colors, radius, spacing, themedSheet, type } from '../../src/ui/theme';

const MAX_LISTED_FILES = 200;
const MAX_PREVIEW_SECTIONS = 12;

/**
 * What the parser made of a note, rather than the note's raw text.
 *
 * This is a diagnostic, and the diagnostic people need. Questions are built
 * from parsed structure, so when a note produces odd questions the useful thing
 * to see is which sections were found, which were skipped, and how many images
 * carried content that couldn't be read — none of which is visible in the
 * markdown source.
 */
function NotePreview({ raw, path }: { raw: string; path: string }) {
  const note = useMemo(() => parseNote(raw, noteStem(path)), [raw, path]);
  const quizzable = note.sections.filter((section) => isQuizzable(section));

  return (
    <View style={styles.preview}>
      <Text style={styles.stat}>
        {note.sections.length} section{note.sections.length === 1 ? '' : 's'} ·{' '}
        {quizzable.length} quizzable
        {note.droppedEmbeds > 0
          ? ` · ${note.droppedEmbeds} image${note.droppedEmbeds === 1 ? '' : 's'} skipped`
          : ''}
      </Text>

      {note.series ? (
        <Text style={styles.muted}>
          Series: {note.series}
          {note.index !== undefined ? ` · no. ${note.index}` : ''}
        </Text>
      ) : null}
      {note.tags.length > 0 ? <Text style={styles.muted}>Tags: {note.tags.join(', ')}</Text> : null}

      {note.sections.slice(0, MAX_PREVIEW_SECTIONS).map((section, index) => {
        const usable = isQuizzable(section);
        return (
          <View key={`${index}-${section.heading ?? ''}`} style={styles.previewSection}>
            <Text style={[styles.previewHeading, !usable && styles.mutedText]}>
              {section.heading ?? '(opening)'}
              {usable ? '' : ' — skipped'}
            </Text>
            <Text style={styles.previewBody} numberOfLines={3}>
              {sectionText(section) ||
                (section.droppedEmbeds > 0 ? 'Only an image — nothing readable.' : 'Empty.')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function SourceDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const source = useSource(id);
  const health = useSourceHealth(id ?? '');

  const [verifying, setVerifying] = useState(false);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [listingError, setListingError] = useState<unknown>(null);
  const [loadingTree, setLoadingTree] = useState(false);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<unknown>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const definition = useMemo(() => (source ? getSourceType(source) : null), [source]);

  const verify = useCallback(async () => {
    if (!source || !definition) return;
    setVerifying(true);
    try {
      const result: SourceHealth = await definition.provider.verify(source);
      setSourceHealth(source.id, result);
    } finally {
      setVerifying(false);
    }
  }, [source, definition]);

  useEffect(() => {
    void verify();
  }, [verify]);

  const fetchTree = useCallback(async () => {
    if (!source || !definition) return;
    setLoadingTree(true);
    setListingError(null);
    try {
      const result = await definition.provider.listFiles(source);
      setListing(result);
      /*
        Health is measured in NOTES, not files.

        A repository full of source code is reachable, non-empty, and completely
        useless to this app. Counting files would report it green and leave
        someone wondering why generation keeps producing nothing.
      */
      const noteCount = result.files.filter((file) => isNotePath(file.path)).length;
      setSourceHealth(source.id, {
        status: noteCount === 0 ? 'empty' : 'ok',
        message: noteCount === 0 && result.files.length > 0 ? 'No markdown notes' : undefined,
        checkedAt: Date.now(),
        fileCount: noteCount,
        truncated: result.truncated,
      });
    } catch (error) {
      setListingError(error);
    } finally {
      setLoadingTree(false);
    }
  }, [source, definition]);

  const readFile = useCallback(
    async (path: string) => {
      if (!source || !definition) return;
      setSelectedPath(path);
      setLoadingFile(true);
      setFileError(null);
      setFileText(null);
      try {
        const text = await definition.provider.readFile(source, path);
        setFileText(text);
      } catch (error) {
        setFileError(error);
      } finally {
        setLoadingFile(false);
      }
    },
    [source, definition],
  );

  const openManage = useCallback(async () => {
    const url = source && definition ? definition.getManageUrl(source) : undefined;
    if (!url) return;
    await WebBrowser.openAuthSessionAsync(url, null).catch(() => undefined);
  }, [source, definition]);

  const confirmRemove = useCallback(() => {
    if (!source) return;
    Alert.alert(
      'Remove this source?',
      `QuizBot will stop reading ${source.fullName}. This does not change anything on GitHub.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeSource(source.id);
            // Otherwise re-adding the same repository would inherit a ledger
            // saying every note is covered, and generation would find nothing
            // to do while the bank sat empty.
            clearCoverageForSource(source.id);
            router.back();
          },
        },
      ],
    );
  }, [source, router]);

  const allFiles = listing?.files ?? [];
  // What the app can actually use. The gap between this and `allFiles` is the
  // most useful thing on the screen when someone connects the wrong repository.
  //
  // Computed above the not-found return, not beside its only use below it:
  // removing the source re-renders this screen with `source` undefined while it
  // is still mounted for the back transition, and a hook after that return
  // would vanish mid-lifetime.
  const notes = useMemo(
    () =>
      allFiles
        .filter((file) => isNotePath(file.path))
        .map((file) => ({ path: file.path, ...parseNoteName(noteStem(file.path)) })),
    [allFiles],
  );

  if (!source || !definition) {
    return (
      <Screen>
        <EmptyState
          icon="help-circle-outline"
          title="Source not found"
          body="It may have been removed."
          actionTitle="Back to sources"
          // '/' is the Today tab now, not the sources list.
          onAction={() => router.replace('/library')}
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: source.name }} />
      <Screen>
        {/* 1. Access ------------------------------------------------------- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Access</Text>
          {verifying ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" />
              <Text style={styles.muted}>Checking access…</Text>
            </View>
          ) : health.status === 'ok' ? (
            <Callout
              tone="success"
              message={`Connected to ${source.fullName}${health.message ? ` · ${health.message}` : ''}`}
            />
          ) : health.status === 'no_access' ? (
            <Callout
              tone="danger"
              title="No access"
              message={health.message ?? "QuizBot can't read this repository."}
            >
              <Button title="Fix access on GitHub" onPress={() => void openManage()} variant="secondary" />
            </Callout>
          ) : health.status === 'error' ? (
            <Callout tone="danger" message={health.message ?? 'Something went wrong.'}>
              <Button title="Check again" onPress={() => void verify()} variant="secondary" />
            </Callout>
          ) : (
            <Button title="Check access" onPress={() => void verify()} variant="secondary" />
          )}
        </View>

        {/* 2. Notes -------------------------------------------------------- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notes</Text>
          <Text style={styles.muted}>
            Reads the whole tree in one request, then keeps the markdown.
          </Text>

          {listingError ? (
            <ErrorBanner
              error={listingError}
              onRetry={() => void fetchTree()}
              onReconnect={() => router.push('/connect/github')}
              onManageAccess={() => void openManage()}
            />
          ) : null}

          <Button
            title={loadingTree ? 'Fetching…' : 'Find notes'}
            onPress={() => void fetchTree()}
            loading={loadingTree}
            variant="secondary"
          />

          {listing ? (
            <>
              <Text style={styles.stat}>
                {notes.length.toLocaleString()} {notes.length === 1 ? 'note' : 'notes'}
                {allFiles.length !== notes.length
                  ? ` · ${(allFiles.length - notes.length).toLocaleString()} other files ignored`
                  : ''}
                {listing.revision ? ` · ${listing.revision.slice(0, 7)}` : ''}
              </Text>

              {listing.truncated ? (
                <Callout
                  tone="warning"
                  title="Partial listing"
                  message={`This repository is too large to list in one request — GitHub caps recursive trees at ${GITHUB.maxTreeEntries.toLocaleString()} entries / 7 MB.`}
                />
              ) : null}

              {notes.length === 0 ? (
                <Callout
                  tone="warning"
                  title="No notes here"
                  message={
                    allFiles.length === 0
                      ? "This repository is empty. The connection is working — there's just nothing to read."
                      : `QuizBot builds questions from markdown (.md) notes, and none of the ${allFiles.length.toLocaleString()} files here are markdown. You may have connected the wrong repository.`
                  }
                />
              ) : (
                <View style={styles.fileList}>
                  {notes.slice(0, MAX_LISTED_FILES).map((note) => (
                    <Pressable
                      key={note.path}
                      onPress={() => void readFile(note.path)}
                      style={({ pressed }) => [
                        styles.fileRow,
                        selectedPath === note.path && styles.fileRowSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      {/* The note's own name, the way it reads in the vault —
                          not the repository path it happens to live at. */}
                      <Text style={styles.noteTitle} numberOfLines={1}>
                        {note.title}
                      </Text>
                      {note.series ? (
                        <Text style={styles.noteSeries} numberOfLines={1}>
                          {note.series}
                          {note.index !== undefined ? ` · ${note.index}` : ''}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                  {notes.length > MAX_LISTED_FILES ? (
                    <Text style={styles.muted}>
                      Showing the first {MAX_LISTED_FILES} of {notes.length.toLocaleString()}.
                    </Text>
                  ) : null}
                </View>
              )}
            </>
          ) : null}
        </View>

        {/* 3. Read a note -------------------------------------------------- */}
        {selectedPath ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Note preview</Text>
            <Text style={styles.muted} numberOfLines={1} ellipsizeMode="middle">
              {selectedPath}
            </Text>

            {loadingFile ? (
              <ActivityIndicator size="small" />
            ) : fileError ? (
              <ErrorBanner error={fileError} onRetry={() => void readFile(selectedPath)} />
            ) : fileText != null ? (
              /*
                Shows what the PARSER sees, not the raw markdown.

                This is the diagnostic that matters: if a note's structure comes
                out wrong, the questions built from it will be wrong too, and
                seeing the raw file gives no hint of that.
              */
              <NotePreview raw={fileText} path={selectedPath} />
            ) : null}
          </View>
        ) : null}

        {__DEV__ ? <DevDiagnostics /> : null}

        <Button title="Manage access on GitHub" onPress={() => void openManage()} variant="secondary" />
        <Button title="Remove source" onPress={confirmRemove} variant="destructive" />
      </Screen>
    </>
  );
}

/**
 * Dev-only affordances for exercising the auth paths that are otherwise painful
 * to reach: rotation, the 401 -> refresh -> retry cycle, and the reauth state.
 */
function DevDiagnostics() {
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (label: string, action: () => Promise<string>) => {
    setBusy(true);
    try {
      setOutput(`${label}: ${await action()}`);
    } catch (error) {
      setOutput(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <View style={[styles.card, styles.devCard]}>
      <Text style={styles.cardTitle}>Diagnostics (dev only)</Text>

      <Button
        title="Show token expiry"
        variant="secondary"
        onPress={() =>
          void run('Token', async () => {
            const record = await peekTokenRecord();
            if (!record) return 'none stored';
            const expires = record.accessTokenExpiresAt
              ? new Date(record.accessTokenExpiresAt).toLocaleTimeString()
              : 'never (expiration disabled on the GitHub App)';
            return `…${record.accessToken.slice(-6)} expires ${expires}, refresh token ${
              record.refreshToken ? `…${record.refreshToken.slice(-6)}` : 'none'
            }`;
          })
        }
      />

      <Button
        title="Force token refresh"
        variant="secondary"
        onPress={() =>
          void run('Refreshed', async () => {
            const before = await peekTokenRecord();
            await forceRefresh();
            const after = await peekTokenRecord();
            const rotated = before?.refreshToken !== after?.refreshToken;
            return `access …${after?.accessToken.slice(-6)}, refresh token ${
              rotated ? 'ROTATED' : 'unchanged'
            }`;
          })
        }
      />

      <Button
        title="Disconnect (clear local credentials)"
        variant="destructive"
        onPress={() =>
          void run('Disconnected', async () => {
            await disconnectGitHub();
            return `local tokens deleted. Revoke on GitHub at ${GITHUB.authorizationsUrl}`;
          })
        }
      />

      {busy ? <ActivityIndicator size="small" /> : null}
      {output ? <Text style={styles.devOutput}>{output}</Text> : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  devCard: { backgroundColor: colors.surface },
  cardTitle: { ...type.bodyStrong, color: colors.text },
  muted: { ...type.small, color: colors.textMuted },
  stat: { ...type.bodyStrong, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fileList: { gap: 2 },
  fileRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  fileRowSelected: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.6 },
  noteTitle: { ...type.body, color: colors.text },
  noteSeries: { ...type.small, color: colors.textMuted },
  preview: { gap: spacing.sm },
  previewSection: {
    gap: 2,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  previewHeading: { ...type.smallStrong, color: colors.text },
  previewBody: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  mutedText: { color: colors.textFaint },
  devOutput: { ...type.mono, color: colors.textMuted },
}));
