import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type {
  CompletionInput,
  CompletionResult,
  HttpRequestSpec,
  LlmModel,
  LlmProviderId,
  ReasoningEffort,
} from './types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * How long one completion may take. Five minutes, up from ninety seconds.
 *
 * Ninety seconds was sized for a request that returns a few hundred tokens of
 * JSON, and that is no longer what these are. `tokenBudget` allows up to 16,000
 * output tokens per call, and on a reasoning model most of that can go on
 * thinking before a visible character is emitted. At the 40–60 tokens/second a
 * large model sustains, a full-budget reply is comfortably past four minutes —
 * so ninety seconds was aborting requests that were working perfectly well, and
 * doing it late enough to have paid for them. That is the "took too long" error.
 *
 * Nothing about this makes a run slower in the ordinary case: the timeout only
 * ever ends a request that would otherwise still be waiting. It stays well
 * inside Anthropic's ten-minute ceiling for non-streaming requests.
 *
 * Bear in mind this budget is counted in FOREGROUND time (see `lib/http.ts`),
 * so it is five minutes of the app actually being open, not of wall-clock.
 */
export const COMPLETION_TIMEOUT_MS = 300_000;

/**
 * How long marking one written answer may take before the app stops waiting.
 *
 * Eight seconds, against five minutes for generation, because the two waits
 * are not alike. Generation has nothing to fall back on; marking does — the
 * reader can mark their own answer, which is what the app did before a model
 * was involved at all. So a slow connection is treated exactly like no
 * connection: the request is abandoned and the self-grade buttons appear.
 * Eight seconds is several times what a cheap model takes to compare one
 * sentence against another on a working connection, and about as long as
 * someone will watch a spinner mid-quiz before it starts to feel stuck.
 *
 * Counted in foreground time like every other timeout (see `lib/http.ts`),
 * and used WITHOUT the transport retries: a retry with its backoff would more
 * than double the wait on precisely the connection this exists to give up on.
 */
export const JUDGE_TIMEOUT_MS = 8_000;

/**
 * How hard the model thinks when WRITING questions.
 *
 * One notch below the reasoning models' own default of 'high' — deliberately.
 * Left unset, a question-writing request spends minutes and thousands of
 * tokens reasoning, which is what pushed long notes toward the completion
 * timeout above. Anthropic's own guidance puts 'medium' at roughly the
 * previous generation's 'high': plenty for turning a note into quiz questions,
 * and meaningfully faster and cheaper per note.
 *
 * Scoped to generation only. Marking already runs a cheap model with a narrow
 * job (see `defaultJudgeModel`), and gets no override here.
 */
export const GENERATION_EFFORT: ReasoningEffort = 'medium';

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
  /**
   * What this provider marks written answers with, when the reader points
   * marking at it explicitly.
   *
   * A separate default from `defaultModel` because the two jobs are not the
   * same size: marking compares a sentence against a model answer, which the
   * cheapest model in the list does well, and it happens several times per
   * quiz. Falls back to `defaultModel` when a provider has nothing cheaper.
   */
  defaultJudgeModel?: string;

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
