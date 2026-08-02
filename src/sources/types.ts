/**
 * An "info source" is anything QuizBot can read material from.
 *
 * The union is the extension point: adding a second kind means adding a member
 * here and a registry entry, after which `tsc --noEmit` points at every place
 * that needs to handle it.
 */
export type InfoSourceType = 'github-repo';

export type InfoSourceBase = {
  /** Deterministic, so re-adding the same repo dedupes instead of duplicating. */
  id: string;
  type: InfoSourceType;
  addedAt: number;
};

export type GitHubRepoSource = InfoSourceBase & {
  type: 'github-repo';
  repoId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived?: boolean;
  installationId: number;
  accountLogin: string;
};

export type InfoSource = GitHubRepoSource;

export function githubSourceId(repoId: number): string {
  return `github-repo:${repoId}`;
}

// ---------------------------------------------------------------------------
// Health — the app's view of whether a source is currently readable
// ---------------------------------------------------------------------------

export type SourceHealthStatus = 'unknown' | 'ok' | 'empty' | 'no_access' | 'error';

export type SourceHealth = {
  status: SourceHealthStatus;
  message?: string;
  checkedAt?: number;
  /** Populated by a successful tree fetch. */
  fileCount?: number;
  truncated?: boolean;
};

// ---------------------------------------------------------------------------
// Content shapes — deliberately source-agnostic so screens don't know about Git
// ---------------------------------------------------------------------------

export type SourceFileEntry = {
  path: string;
  /** Bytes, when the provider knows it. */
  size?: number;
  /**
   * A marker that changes when this file's content changes — the Git blob SHA
   * for a repository.
   *
   * Load-bearing rather than informational: it is the only way generation knows
   * a note has been edited, and therefore the only thing stopping it paying to
   * re-read notes it has already covered.
   */
  contentHash?: string;
};

export type FileListing = {
  files: SourceFileEntry[];
  /** True when the provider could not return the complete list. */
  truncated: boolean;
  /** Provider-specific revision marker (a commit SHA for Git). */
  revision?: string;
};
