import { getGitHubConfig } from '../../config/env';
import { AppError, toAppError } from '../../lib/errors';
import type { SourceContentProvider, SourceTypeDefinition } from '../../sources/contract';
import type { FileListing, GitHubRepoSource, SourceHealth } from '../../sources/types';
import { getFileRaw } from './api/contents';
import { getBranchHead, getRepo, getTreeRecursive } from './api/repos';
import { manageInstallationUrl } from './config';

/**
 * The GitHub implementation of the source contract. This file is the seam:
 * everything above it (screens, list rows, the detail screen) is source-agnostic.
 */
const provider: SourceContentProvider<GitHubRepoSource> = {
  async verify(source): Promise<SourceHealth> {
    try {
      const repo = await getRepo(source.owner, source.name);
      return {
        status: 'ok',
        checkedAt: Date.now(),
        message: `${repo.default_branch} · ${repo.private ? 'Private' : 'Public'}`,
      };
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'github_not_found' || appError.code === 'github_forbidden') {
        return { status: 'no_access', message: appError.message, checkedAt: Date.now() };
      }
      return { status: 'error', message: appError.message, checkedAt: Date.now() };
    }
  },

  async listFiles(source): Promise<FileListing> {
    try {
      const head = await getBranchHead(source.owner, source.name, source.defaultBranch);
      const tree = await getTreeRecursive(source.owner, source.name, head.treeSha);

      return {
        // Only blobs are files; the tree also contains directory entries.
        files: tree.tree
          .filter((entry) => entry.type === 'blob')
          // The blob SHA comes free with the tree — no extra request — and is
          // what lets generation tell an edited note from an unchanged one.
          .map((entry) => ({ path: entry.path, size: entry.size, contentHash: entry.sha })),
        truncated: tree.truncated === true,
        revision: head.commitSha,
      };
    } catch (error) {
      const appError = toAppError(error);
      // A repo with no commits 409s here. That is a healthy connection with
      // nothing in it, not a failure, so let callers distinguish it.
      if (appError.code === 'github_repo_empty') {
        return { files: [], truncated: false };
      }
      throw appError;
    }
  },

  async readFile(source, path, options = {}): Promise<string> {
    /*
      Defaults to the branch, but callers that recorded a blob SHA must pass the
      commit `ref` they listed at.

      A branch is a moving target: if a push lands between listing and reading,
      the content returned here belongs to a different commit than the hash the
      caller is about to store. The note would then look permanently covered at
      a version nobody ever read.
    */
    return getFileRaw(source.owner, source.name, path, {
      ref: options.ref ?? source.defaultBranch,
      signal: options.signal,
    });
  },
};

export const githubRepoSourceType: SourceTypeDefinition<GitHubRepoSource> = {
  type: 'github-repo',
  label: 'GitHub Repo',
  description: 'Build questions from markdown notes in a repository you choose',
  icon: 'logo-github',
  connectRoute: '/connect/github',
  getTitle: (source) => source.fullName,
  getSubtitle: (source) =>
    [source.private ? 'Private' : 'Public', source.defaultBranch, source.archived ? 'Archived' : null]
      .filter(Boolean)
      .join(' · '),
  getManageUrl: () => {
    const config = getGitHubConfig();
    return config ? manageInstallationUrl(config.appSlug) : undefined;
  },
  provider,
};

export { AppError };
