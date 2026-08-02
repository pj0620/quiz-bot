import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { requireGitHubConfig } from '../../../src/config/env';
import {
  listInstallationRepositories,
  listUserInstallations,
} from '../../../src/features/github/api/installations';
import { installUrl } from '../../../src/features/github/config';
import { RepoRow } from '../../../src/features/github/ui/RepoRow';
import type { Installation, Repository } from '../../../src/features/github/types';
import { addSources } from '../../../src/sources/store';
import { githubSourceId, type GitHubRepoSource } from '../../../src/sources/types';
import { useSources } from '../../../src/sources/useSources';
import { Button } from '../../../src/ui/components/Button';
import { LoadingBlock } from '../../../src/ui/components/LoadingBlock';
import { TextField } from '../../../src/ui/components/TextField';
import { Callout } from '../../../src/ui/components/Callout';
import { ErrorBanner } from '../../../src/ui/components/ErrorBanner';
import { Screen } from '../../../src/ui/components/Screen';
import { colors, radius, spacing, type } from '../../../src/ui/theme';

type Group = {
  installation: Installation;
  repos: Repository[];
};

export default function PickReposScreen() {
  const router = useRouter();
  const existing = useSources();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');

  const alreadyAdded = useMemo(
    () => new Set(existing.map((source) => source.id)),
    [existing],
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const installations = await listUserInstallations();
      const loaded = await Promise.all(
        installations.map(async (installation) => ({
          installation,
          repos: await listInstallationRepositories(installation.id),
        })),
      );
      setGroups(loaded);
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((repoId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  }, []);

  const openManagePage = useCallback(async () => {
    const { appSlug } = requireGitHubConfig();
    await WebBrowser.openAuthSessionAsync(installUrl(appSlug), null).catch(() => undefined);
    void load();
  }, [load]);

  const addSelected = useCallback(() => {
    if (!groups) return;

    const sources: GitHubRepoSource[] = [];
    for (const group of groups) {
      for (const repo of group.repos) {
        if (!selected.has(repo.id)) continue;
        sources.push({
          id: githubSourceId(repo.id),
          type: 'github-repo',
          addedAt: Date.now(),
          repoId: repo.id,
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          private: repo.private,
          archived: repo.archived,
          installationId: group.installation.id,
          accountLogin: group.installation.account?.login ?? repo.owner.login,
        });
      }
    }

    addSources(sources);
    // Close the whole connect stack so the user lands back on the list.
    router.dismissAll();
  }, [groups, selected, router]);

  const filtered = useMemo(() => {
    if (!groups) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        repos: group.repos.filter((repo) => repo.full_name.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.repos.length > 0);
  }, [groups, query]);

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

  if (!groups || !filtered) {
    return (
      <Screen>
        <LoadingBlock message="Loading your repositories…" />
      </Screen>
    );
  }

  const totalRepos = groups.reduce((sum, group) => sum + group.repos.length, 0);

  if (totalRepos === 0) {
    return (
      <Screen>
        <Callout
          tone="warning"
          title="No repositories available"
          message="QuizBot is installed but can't see any repositories. Choose some on GitHub to continue."
        />
        <Button title="Manage access on GitHub" onPress={() => void openManagePage()} />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Said here, at the moment of choosing, rather than after generation
          returns nothing from a repository full of source code. */}
      <Callout
        tone="info"
        message="Pick the repository holding your markdown notes — QuizBot reads .md files and builds questions from them."
      />

      <TextField
        placeholder="Search repositories"
        value={query}
        onChangeText={setQuery}
        clearButtonMode="while-editing"
      />

      {filtered.map((group) => (
        <View key={group.installation.id} style={styles.group}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>
              {group.installation.account?.login ?? `Installation ${group.installation.id}`}
            </Text>
            <Text style={styles.groupMeta}>
              {group.installation.repository_selection === 'all' ? 'All repos' : 'Selected repos'}
            </Text>
          </View>

          {group.repos.length === 0 ? (
            <Text style={styles.body}>Nothing QuizBot can see in this account.</Text>
          ) : (
            group.repos.map((repo) => (
              <RepoRow
                key={repo.id}
                repo={repo}
                selected={selected.has(repo.id)}
                alreadyAdded={alreadyAdded.has(githubSourceId(repo.id))}
                onToggle={() => toggle(repo.id)}
              />
            ))
          )}
        </View>
      ))}

      {filtered.length === 0 ? (
        <Text style={styles.body}>No repositories match "{query}".</Text>
      ) : null}

      <Button
        title={
          selected.size === 0
            ? 'Select at least one repository'
            : `Add ${selected.size} ${selected.size === 1 ? 'source' : 'sources'}`
        }
        onPress={addSelected}
        disabled={selected.size === 0}
      />
      <Button title="Manage access on GitHub" onPress={() => void openManagePage()} variant="plain" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  groupTitle: { ...type.bodyStrong, color: colors.text },
  groupMeta: { ...type.small, color: colors.textMuted },
  body: { ...type.body, color: colors.textMuted },
});
