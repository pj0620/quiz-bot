import { useSyncExternalStore } from 'react';

import { sourcesStore } from './store';
import type { InfoSource, SourceHealth } from './types';

const UNKNOWN_HEALTH: SourceHealth = { status: 'unknown' };

export function useSources(): InfoSource[] {
  // Selecting `state.sources` returns the same array reference until a mutation
  // replaces it, which is what useSyncExternalStore's Object.is check needs.
  return useSyncExternalStore(
    sourcesStore.subscribe,
    () => sourcesStore.get().sources,
    () => sourcesStore.get().sources,
  );
}

export function useSource(id: string | undefined): InfoSource | undefined {
  const sources = useSources();
  return id ? sources.find((source) => source.id === id) : undefined;
}

export function useSourceHealth(id: string): SourceHealth {
  return useSyncExternalStore(
    sourcesStore.subscribe,
    () => sourcesStore.get().health[id] ?? UNKNOWN_HEALTH,
    () => sourcesStore.get().health[id] ?? UNKNOWN_HEALTH,
  );
}
