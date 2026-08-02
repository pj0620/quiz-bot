import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { AppState, type AppStateStatus, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { requireGitHubConfig } from '../../../src/config/env';
import { listUserInstallations } from '../../../src/features/github/api/installations';
import { installUrl } from '../../../src/features/github/config';
import type { Installation } from '../../../src/features/github/types';
import { sleep } from '../../../src/lib/time';
import { Button } from '../../../src/ui/components/Button';
import { LoadingBlock } from '../../../src/ui/components/LoadingBlock';
import { SectionHeader } from '../../../src/ui/components/SectionHeader';
import { Callout } from '../../../src/ui/components/Callout';
import { ErrorBanner } from '../../../src/ui/components/ErrorBanner';
import { Screen } from '../../../src/ui/components/Screen';
import { colors, spacing, type } from '../../../src/ui/theme';

/** GitHub's installation state can lag a second or two behind the browser. */
const RECHECK_ATTEMPTS = 10;
const RECHECK_INTERVAL_MS = 2000;

export default function InstallScreen() {
  const router = useRouter();
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const navigatedRef = useRef(false);

  const load = useCallback(async (): Promise<Installation[] | null> => {
    try {
      const result = await listUserInstallations();
      setInstallations(result);
      setError(null);
      return result;
    } catch (caught) {
      setError(caught);
      return null;
    }
  }, []);

  /**
   * There is no redirect back into the app after installing (device flow has no
   * callback, which is exactly why it needs no custom URL scheme). So we poll a
   * bounded number of times and also expose a manual button.
   */
  const recheck = useCallback(async () => {
    setChecking(true);
    const before = installations?.length ?? 0;
    try {
      for (let attempt = 0; attempt < RECHECK_ATTEMPTS; attempt += 1) {
        const result = await load();
        if (result && result.length > before) break;
        if (attempt < RECHECK_ATTEMPTS - 1) await sleep(RECHECK_INTERVAL_MS);
      }
    } finally {
      setChecking(false);
    }
  }, [installations, load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Covers the user leaving to the real Safari app rather than the in-app sheet.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  const openInstallPage = useCallback(async () => {
    const { appSlug } = requireGitHubConfig();
    await WebBrowser.openAuthSessionAsync(installUrl(appSlug), null).catch(() => undefined);
    void recheck();
  }, [recheck]);

  const openManagePage = useCallback(
    async (installation?: Installation) => {
      const { appSlug } = requireGitHubConfig();
      await WebBrowser.openAuthSessionAsync(
        installation?.html_url ?? installUrl(appSlug),
        null,
      ).catch(() => undefined);
      void recheck();
    },
    [recheck],
  );

  // Everything already narrowed to selected repos? Nothing to decide here.
  useEffect(() => {
    if (navigatedRef.current || !installations || installations.length === 0) return;
    const allNarrowed = installations.every((item) => item.repository_selection === 'selected');
    if (allNarrowed) {
      navigatedRef.current = true;
      router.replace('/connect/github/repos');
    }
  }, [installations, router]);

  if (error) {
    return (
      <Screen>
        <ErrorBanner
          error={error}
          onRetry={() => void load()}
          onReconnect={() => router.replace('/connect/github')}
          onManageAccess={() => void openManagePage()}
        />
      </Screen>
    );
  }

  if (installations === null) {
    return (
      <Screen>
        <LoadingBlock message="Checking what QuizBot can access…" />
      </Screen>
    );
  }

  if (installations.length === 0) {
    return (
      <Screen>
        <Text style={styles.heading}>Choose which repositories to share</Text>
        <Text style={styles.body}>
          You're signed in, but QuizBot can't see any repositories yet. On GitHub, pick
          <Text style={styles.emphasis}> Only select repositories</Text> and choose the ones you want
          to be quizzed on.
        </Text>
        <Button title="Choose repositories on GitHub" onPress={openInstallPage} />
        <Button
          title={checking ? 'Checking…' : 'Check again'}
          onPress={() => void recheck()}
          variant="secondary"
          loading={checking}
        />
      </Screen>
    );
  }

  const broad = installations.filter((item) => item.repository_selection === 'all');

  return (
    <Screen>
      {broad.length > 0 ? (
        <Callout
          tone="warning"
          title="QuizBot can read every repository"
          message={`QuizBot currently has access to all repositories in ${broad
            .map((item) => item.account?.login ?? 'your account')
            .join(', ')}. It only needs the ones you'll be quizzed on.`}
        >
          <Button title="Limit access" onPress={() => void openManagePage(broad[0])} />
          <Button
            title="Continue anyway"
            onPress={() => router.replace('/connect/github/repos')}
            variant="secondary"
          />
        </Callout>
      ) : null}

      <SectionHeader title="Connected accounts" />
      {installations.map((item) => (
        <View key={item.id} style={styles.accountRow}>
          <Text style={styles.accountName}>{item.account?.login ?? `Installation ${item.id}`}</Text>
          <Text style={styles.accountMeta}>
            {item.repository_selection === 'all' ? 'All repositories' : 'Selected repositories'}
          </Text>
        </View>
      ))}

      {broad.length === 0 ? (
        <Button title="Continue" onPress={() => router.replace('/connect/github/repos')} />
      ) : null}
      <Button title="Manage access on GitHub" onPress={() => void openManagePage()} variant="plain" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.textMuted, lineHeight: 22 },
  emphasis: { ...type.bodyStrong, color: colors.text },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  accountName: { ...type.bodyStrong, color: colors.text },
  accountMeta: { ...type.small, color: colors.textMuted },
});
