import type { LlmProviderDefinition } from './contract';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import type { LlmProviderId } from './types';

/**
 * The single place LLM providers are registered.
 *
 * Mirrors `src/sources/registry.ts` and the question-type registry: because
 * this is a mapped type over `LlmProviderId`, adding a member to that union
 * without adding an entry here is a compile error, so a provider cannot be
 * half-wired.
 *
 * Adding one is: a member on the union, one provider file, one line here.
 */
const LLM_PROVIDERS: { [K in LlmProviderId]: LlmProviderDefinition } = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

export function getLlmProvider(id: LlmProviderId): LlmProviderDefinition {
  return LLM_PROVIDERS[id];
}

/** Drives the provider picker in settings. Adding a provider adds a row. */
export function listLlmProviders(): LlmProviderDefinition[] {
  return Object.values(LLM_PROVIDERS);
}

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string' && value in LLM_PROVIDERS;
}
