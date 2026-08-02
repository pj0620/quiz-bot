import { createStore } from '../lib/createStore';
import { dedupeById, loadSourcesSync, saveSources } from './storage';
import type { InfoSource, SourceHealth } from './types';

type SourcesState = {
  sources: InfoSource[];
  health: Record<string, SourceHealth>;
};

export const sourcesStore = createStore<SourcesState>({
  sources: loadSourcesSync(),
  health: {},
});

function persist(sources: InfoSource[]): void {
  // Keep the in-memory state authoritative; a failed disk write should not undo
  // what the user just did, and the next mutation retries it.
  void saveSources(sources).catch(() => undefined);
}

export function addSources(incoming: InfoSource[]): void {
  const state = sourcesStore.get();
  // Existing entries win, so re-adding a repo is a no-op rather than resetting
  // its addedAt or clobbering fields.
  const next = dedupeById([...state.sources, ...incoming]);
  sourcesStore.set({ ...state, sources: next });
  persist(next);
}

export function removeSource(id: string): void {
  const state = sourcesStore.get();
  const next = state.sources.filter((source) => source.id !== id);
  const health = { ...state.health };
  delete health[id];
  sourcesStore.set({ sources: next, health });
  persist(next);
}

export function removeSourcesOfType(type: InfoSource['type']): void {
  const state = sourcesStore.get();
  const next = state.sources.filter((source) => source.type !== type);
  sourcesStore.set({ ...state, sources: next });
  persist(next);
}

export function setSourceHealth(id: string, health: SourceHealth): void {
  const state = sourcesStore.get();
  sourcesStore.set({ ...state, health: { ...state.health, [id]: health } });
}

export function getSources(): InfoSource[] {
  return sourcesStore.get().sources;
}

export function getSourceById(id: string): InfoSource | undefined {
  return sourcesStore.get().sources.find((source) => source.id === id);
}
