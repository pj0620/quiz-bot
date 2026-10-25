import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type {
  FileListing,
  InfoSource,
  InfoSourceType,
  SourceFileWrite,
  SourceHealth,
  SourceWriteAccess,
  SourceWriteResult,
} from './types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Everything the UI needs to render and connect a kind of source, without any
 * screen importing GitHub code directly.
 */
export type SourceTypeDefinition<T extends InfoSource = InfoSource> = {
  type: InfoSourceType;
  /** Shown in the "add a source" picker. */
  label: string;
  description: string;
  icon: IoniconName;
  /** Route that starts the connect flow for this type. */
  connectRoute: string;
  getTitle(source: T): string;
  getSubtitle(source: T): string;
  /** Deep link for the user to widen/narrow what this source can read. */
  getManageUrl(source: T): string | undefined;
  provider: SourceContentProvider<T>;
};

/**
 * The read API every source type must implement. `app/sources/[id].tsx` talks
 * only to this, so a future non-GitHub source reuses that screen unchanged.
 */
export type SourceContentProvider<T extends InfoSource = InfoSource> = {
  /** Cheap reachability probe used to compute health. */
  verify(source: T, signal?: AbortSignal): Promise<SourceHealth>;
  listFiles(source: T, signal?: AbortSignal): Promise<FileListing>;
  /**
   * Reads one file.
   *
   * `ref` pins the read to a specific revision — pass `FileListing.revision` to
   * guarantee the content matches the `contentHash` that was listed alongside
   * it. Omitting it reads from the source's current head, which is fine for a
   * one-off preview and wrong for anything that records what it read.
   */
  readFile(
    source: T,
    path: string,
    options?: { ref?: string; signal?: AbortSignal },
  ): Promise<string>;

  /**
   * Whether this credential may write to the source right now. Optional with
   * `writeFiles`: a source that cannot be written to simply leaves both out,
   * and the sync screen says so instead of failing on the first commit.
   */
  canWrite?(source: T): Promise<SourceWriteAccess>;
  /**
   * Writes and deletes a set of files as ONE revision — for Git, one commit —
   * so a sync is all-or-nothing and the history reads as one change.
   */
  writeFiles?(source: T, files: readonly SourceFileWrite[], message: string): Promise<SourceWriteResult>;
};
