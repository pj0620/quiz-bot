import { llmStore, type KeyStatus } from './settings';
import type { GeneratorId, JudgeId, LlmProviderId, LlmSettings } from './types';

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

/** Every provider's status at once, for a screen that shows them side by side. */
export function useKeyStatuses(): Record<LlmProviderId, KeyStatus> {
  return llmStore.useSelector((state) => state.keyStatus);
}

export function useModelFor(providerId: LlmProviderId): string {
  return llmStore.useSelector((state) => state.settings.models[providerId] ?? '');
}

export function useJudgeId(): JudgeId {
  return llmStore.useSelector((state) => state.settings.judgeId ?? 'match');
}

export function useJudgeModelFor(providerId: LlmProviderId): string {
  return llmStore.useSelector((state) => state.settings.judgeModels?.[providerId] ?? '');
}

export function useConcurrency(): number {
  return llmStore.useSelector((state) => state.settings.concurrency);
}

export function useGuidance(): string {
  return llmStore.useSelector((state) => state.settings.guidance ?? '');
}
