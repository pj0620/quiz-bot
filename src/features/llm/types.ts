/**
 * The LLM layer's domain types.
 *
 * Kept free of React and of any provider SDK: the whole point of this module is
 * that swapping OpenAI for Anthropic is a registry entry, and that the request
 * and response shaping for each is a pure function anyone can test.
 */

export type LlmProviderId = 'openai' | 'anthropic';

/**
 * What produces questions. `mock` is the offline generator that ships with the
 * app; the rest call out to a provider.
 *
 * One union rather than a separate "use mock" boolean, because these are
 * genuinely mutually exclusive and a boolean plus a provider id can represent
 * states that don't mean anything.
 */
export type GeneratorId = 'mock' | LlmProviderId;

export type LlmModel = {
  id: string;
  label: string;
  /** Relative cost/speed, shown next to the preset so the choice is informed. */
  note?: string;
};

export type CompletionInput = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Upper bound on the response. Anthropic requires it; OpenAI accepts it. */
  maxTokens: number;
  /** Ask the provider for JSON output where it supports a native mode. */
  json: boolean;
  signal?: AbortSignal;
};

/**
 * Why the model stopped.
 *
 * `length` matters more than it looks: a response truncated at the token limit
 * produces JSON that cannot parse, and "the model hit the cap" is a far more
 * useful thing to tell someone than "invalid JSON".
 */
export type StopReason = 'stop' | 'length' | 'other';

export type CompletionResult = {
  text: string;
  stopReason: StopReason;
  usage: { inputTokens: number; outputTokens: number };
};

/** A request described but not sent, so shaping can be tested without fetch. */
export type HttpRequestSpec = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type LlmSettings = {
  generatorId: GeneratorId;
  /**
   * Chosen model per provider rather than one field, so switching provider and
   * back doesn't silently reset a deliberate choice.
   */
  models: Record<LlmProviderId, string>;
};
