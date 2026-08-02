import { llmStore, type KeyStatus } from './settings';
import type { GeneratorId, LlmProviderId, LlmSettings } from './types';

/**
 * React bindings for the LLM settings store.
 *
 * Separate from `settings.ts` for the same reason the other stores split this
 * way: the mutation API stays importable from non-React code (the poller),
 * and every selector here returns a stable reference, which
 * `useSyncExternalStore` requires.
 */

export function useLlmSettings(): LlmSettings {
  return llmStore.useSelector((state) => state.settings);
}

export function useGeneratorId(): GeneratorId {
  return llmStore.useSelector((state) => state.settings.generatorId);
}

export function useKeyStatus(providerId: LlmProviderId): KeyStatus {
  return llmStore.useSelector((state) => state.keyStatus[providerId] ?? 'unknown');
}

export function useModelFor(providerId: LlmProviderId): string {
  return llmStore.useSelector((state) => state.settings.models[providerId] ?? '');
}
