import { getGitHubConfig } from '../../config/env';
import { AppError, toAppError } from '../../lib/errors';
import type { SourceContentProvider, SourceTypeDefinition } from '../../sources/contract';
import type {
  FileListing,
  GitHubRepoSource,
  SourceFileWrite,
  SourceHealth,
  SourceWriteAccess,
  SourceWriteResult,
} from '../../sources/types';
import { getFileRaw } from './api/contents';
import { createBlob, createCommit, createTree, updateRef, type TreeWrite } from './api/git';
import { listUserInstallations } from './api/installations';
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

  /*
    Write access is a property of the INSTALLATION, not of the token. The App
    asks for Contents: read and write, but an installation made when it only
    asked for read keeps read until the owner accepts the new permission on
    GitHub's installation page — so this looks the installation up rather than
    trying a write and reading the 403.
  */
  async canWrite(source): Promise<SourceWriteAccess> {
    const installations = await listUserInstallations();
    const installation = installations.find((entry) => entry.id === source.installationId);
    const config = getGitHubConfig();
    if (!installation) {
      return {
        ok: false,
        reason: 'QuizBot is no longer installed for this repository.',
        manageUrl: config ? manageInstallationUrl(config.appSlug) : undefined,
      };
    }
    if (installation.permissions?.contents === 'write') return { ok: true };
    return {
      ok: false,
      reason: 'QuizBot can read this repository but has not been granted write access yet.',
      manageUrl: manageInstallationUrl(config?.appSlug ?? '', installation.html_url),
    };
  },

  /*
    One commit for the whole set: blobs, then a tree on the branch's current
    tree, then a commit whose parent is the branch head, then a fast-forward of
    the branch. If someone pushed in between, the last step refuses and the
    caller re-plans from a fresh listing rather than overwriting their work.
  */
  async writeFiles(source, files: readonly SourceFileWrite[], message): Promise<SourceWriteResult> {
    const { owner, name, defaultBranch } = source;
    const head = await getBranchHead(owner, name, defaultBranch);

    const contentHashes: Record<string, string> = {};
    const entries: TreeWrite[] = await Promise.all(
      files.map(async (file): Promise<TreeWrite> => {
        if ('delete' in file) return { path: file.path, sha: null };
        const sha = await createBlob(owner, name, file.content);
        contentHashes[file.path] = sha;
        return { path: file.path, sha };
      }),
    );

    const tree = await createTree(owner, name, head.treeSha, entries);
    const commit = await createCommit(owner, name, { message, tree, parents: [head.commitSha] });
    await updateRef(owner, name, defaultBranch, commit);
    return { revision: commit, contentHashes };
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
