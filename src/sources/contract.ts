import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { FileListing, InfoSource, InfoSourceType, SourceHealth } from './types';

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
};
