import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { CompletionInput, CompletionResult, HttpRequestSpec, LlmModel, LlmProviderId } from './types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Everything the app needs to talk to one LLM provider.
 *
 * Deliberately split three ways. `buildRequest` and `parseResponse` are pure,
 * so the parts most likely to be wrong — auth header names, body field names,
 * where the text actually sits in the response — are testable without mocking
 * fetch. `complete` is the thin I/O wrapper around them.
 */
export type LlmProviderDefinition = {
  id: LlmProviderId;
  label: string;
  icon: IoniconName;

  /** Where the user goes to create a key. Shown as a link in settings. */
  consoleUrl: string;
  /** What their key looks like, so a pasted wrong-provider key is obvious. */
  keyPrefix: string;
  keyHint: string;

  /** Suggested models. Not exhaustive — the model field is editable. */
  models: LlmModel[];
  defaultModel: string;

  buildRequest(input: CompletionInput): HttpRequestSpec;
  parseResponse(json: unknown): CompletionResult;
  complete(input: CompletionInput): Promise<CompletionResult>;
};

/**
 * A cheap sanity check on a pasted key, used only to warn — never to block.
 *
 * Prefixes are a provider convention, not a guarantee, and refusing to save a
 * key because it didn't match a hardcoded prefix would be worse than letting
 * the Test button report the real answer.
 */
export function looksLikeKeyFor(provider: LlmProviderDefinition, key: string): boolean {
  return key.trim().startsWith(provider.keyPrefix);
}
