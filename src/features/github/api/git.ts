import { AppError, toAppError } from '../../../lib/errors';
import { encodeFilePath, encodePathSegment } from '../../../lib/query';
import type {
  GitBlobResponse,
  GitCommitWriteResponse,
  GitTreeWriteEntry,
  GitTreeWriteResponse,
} from '../types';
import { githubRequest } from './client';

/**
 * The Git Data API: blobs, trees, commits, refs.
 *
 * Used instead of the contents endpoint for writing because a sync touches
 * several files and should read as ONE commit — and because blobs accept
 * `encoding: "utf-8"`, which keeps base64 out of the app entirely (see the
 * note on Hermes in `contents.ts`). The ref update names the commit's parent,
 * so a push that landed meanwhile fails loudly as a conflict rather than being
 * overwritten.
 */

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function post<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  return githubRequest<T>(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export async function createBlob(owner: string, repo: string, content: string): Promise<string> {
  const blob = await post<GitBlobResponse>(`${repoPath(owner, repo)}/git/blobs`, {
    content,
    encoding: 'utf-8',
  });
  return blob.sha;
}

export type TreeWrite = { path: string; sha: string | null };

/** A new tree on top of `baseTree`; a null sha removes that path. */
export async function createTree(
  owner: string,
  repo: string,
  baseTree: string,
  entries: readonly TreeWrite[],
): Promise<string> {
  const tree: GitTreeWriteEntry[] = entries.map((entry) => ({
    path: entry.path,
    mode: '100644',
    type: 'blob',
    sha: entry.sha,
  }));
  const result = await post<GitTreeWriteResponse>(`${repoPath(owner, repo)}/git/trees`, {
    base_tree: baseTree,
    tree,
  });
  return result.sha;
}

export async function createCommit(
  owner: string,
  repo: string,
  input: { message: string; tree: string; parents: readonly string[] },
): Promise<string> {
  const result = await post<GitCommitWriteResponse>(`${repoPath(owner, repo)}/git/commits`, {
    message: input.message,
    tree: input.tree,
    parents: input.parents,
  });
  return result.sha;
}

/**
 * Fast-forwards a branch to `sha`. GitHub refuses with 422 when the branch has
 * moved past the commit's parent, which arrives here as `github_write_conflict`.
 */
export async function updateRef(owner: string, repo: string, branch: string, sha: string): Promise<void> {
  try {
    await post(`${repoPath(owner, repo)}/git/refs/heads/${encodeFilePath(branch)}`, { sha, force: false }, 'PATCH');
  } catch (error) {
    const appError = toAppError(error);
    if (/fast.forward|not a fast|reference .*changed/i.test(appError.message)) {
      throw new AppError('github_write_conflict', { cause: error });
    }
    throw appError;
  }
}
