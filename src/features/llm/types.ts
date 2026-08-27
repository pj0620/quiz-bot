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

/**
 * What a model is being asked to do.
 *
 * The two jobs are genuinely different work. Writing questions is a long,
 * open-ended read of a whole note where capability shows; marking a written
 * answer is one short, narrow judgement made many times a session. So they are
 * worth pointing at different models — a strong one to write with, a cheap fast
 * one to mark with — and this is the seam that lets them differ.
 */
export type LlmRole = 'generate' | 'judge';

/**
 * Who marks written answers.
 *
 * `match` — follow the generator, provider AND model. The default, because it
 * is what the app did before the choice existed, and because a reader who has
 * configured one provider should not have to configure a second one to be
 * marked. A provider id here means "mark with this instead", using that
 * provider's own judge model, and it applies even when questions are generated
 * offline by `mock`.
 */
export type JudgeId = 'match' | LlmProviderId;

export type LlmModel = {
  id: string;
  label: string;
  /** Relative cost/speed, shown next to the preset so the choice is informed. */
  note?: string;
};

/**
 * How much internal reasoning a request may spend before answering.
 *
 * A shared vocabulary the providers translate — Anthropic's `output_config.effort`
 * and OpenAI's `reasoning_effort` both accept these words directly.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export type CompletionInput = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Upper bound on the response. Anthropic requires it; OpenAI accepts it. */
  maxTokens: number;
  /** Ask the provider for JSON output where it supports a native mode. */
  json: boolean;
  /**
   * Reasoning depth, where the model supports choosing one. Omitted means the
   * provider's own default — which for current reasoning models is 'high', a
   * notch above what question-writing needs. Providers only forward this to
   * models known to accept it, because the model id is free text in Settings
   * and an unsupported parameter is an HTTP 400, not a softer request.
   */
  effort?: ReasoningEffort;
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
  /** Who marks written answers. See `JudgeId`. */
  judgeId: JudgeId;
  /**
   * The model used for marking, per provider — kept apart from `models` for the
   * same reason `models` is kept per provider: choosing Haiku to mark with must
   * not overwrite the Sonnet chosen to write with.
   */
  judgeModels: Record<LlmProviderId, string>;
  /**
   * Notes generated at the same time. A run of ten notes at two takes about as
   * long as five would.
   *
   * Exposed as a setting rather than fixed because the right number is a
   * property of the account, not of the app: provider rate limits differ by tier
   * and a long note is several requests on its own, so the ceiling that keeps
   * one person fast will make another's run fail with 429s.
   */
  concurrency: number;
  /**
   * The reader's own instructions, appended to every generation prompt.
   *
   * What makes a good question is a matter of taste — how hard, how broad, which
   * formats, what to leave alone — and taste is not something the app can settle
   * on someone's behalf. This is the seam for it: whatever they write goes in
   * last and outranks the built-in preferences. Empty by default, and empty
   * costs nothing, because the section is omitted entirely rather than sent as a
   * blank heading.
   */
  guidance: string;
};
