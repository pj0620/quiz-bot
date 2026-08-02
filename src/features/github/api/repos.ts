import { buildQuery, encodePathSegment } from '../../../lib/query';
import type { CommitResponse, Repository, TreeResponse } from '../types';
import { githubRequest } from './client';

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
}

export async function getRepo(owner: string, repo: string): Promise<Repository> {
  return githubRequest<Repository>(repoPath(owner, repo));
}

/**
 * Resolves a branch to its tree SHA via the commit.
 *
 * The tree endpoint accepts a branch name directly, but going through the commit
 * also yields the commit SHA — useful later for caching and for showing the user
 * exactly which revision a quiz was generated from.
 */
export async function getBranchHead(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ commitSha: string; treeSha: string }> {
  const commit = await githubRequest<CommitResponse>(
    `${repoPath(owner, repo)}/commits/${encodePathSegment(branch)}`,
  );
  return { commitSha: commit.sha, treeSha: commit.commit.tree.sha };
}

/**
 * Fetches the full file tree in one request.
 *
 * GitHub caps this at 100,000 entries / 7 MB and sets `truncated: true` when it
 * hits that ceiling — callers must surface that rather than silently showing a
 * partial listing.
 */
export async function getTreeRecursive(
  owner: string,
  repo: string,
  treeSha: string,
): Promise<TreeResponse> {
  return githubRequest<TreeResponse>(
    `${repoPath(owner, repo)}/git/trees/${encodePathSegment(treeSha)}${buildQuery({ recursive: 1 })}`,
  );
}
