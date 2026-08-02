import { HttpError, requestJson } from '../../../lib/http';
import type { LlmProviderDefinition } from '../contract';
import { classifyLlmError } from '../errors';
import type { CompletionInput, CompletionResult, HttpRequestSpec, StopReason } from '../types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** Pinned per Anthropic's versioning scheme; not the model version. */
const API_VERSION = '2023-06-01';

/** Generation is slower than a normal API call, so the 15s default is too tight. */
const TIMEOUT_MS = 90_000;

export function buildRequest(input: CompletionInput): HttpRequestSpec {
  return {
    url: ENDPOINT,
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': API_VERSION,
    },
    /*
      The system prompt is a TOP-LEVEL field, not a message with role "system".
      Passing it as a message is the most common way to get this wrong, and it
      fails as a 400 rather than being silently ignored.

      There is no native JSON mode; `input.json` is honoured by the prompt
      instead, and the shared parser tolerates a fenced reply.
    */
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    }),
  };
}

type AnthropicResponse = {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function parseResponse(json: unknown): CompletionResult {
  const response = (json ?? {}) as AnthropicResponse;

  // Concatenate every text block: a reply may also carry non-text blocks, and
  // taking only content[0] would return an empty string whenever one leads.
  const text = (response.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');

  return {
    text,
    stopReason: toStopReason(response.stop_reason),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

function toStopReason(value: string | undefined): StopReason {
  if (value === 'end_turn' || value === 'stop_sequence') return 'stop';
  if (value === 'max_tokens') return 'length';
  return 'other';
}

async function complete(input: CompletionInput): Promise<CompletionResult> {
  const spec = buildRequest(input);
  try {
    const { data } = await requestJson<unknown>(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: spec.body,
      timeoutMs: TIMEOUT_MS,
      signal: input.signal,
    });
    return parseResponse(data);
  } catch (error) {
    if (error instanceof HttpError) throw classifyLlmError(error.status, error.bodyJson);
    throw error;
  }
}

export const anthropicProvider: LlmProviderDefinition = {
  id: 'anthropic',
  label: 'Anthropic',
  icon: 'sparkles-outline',
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  keyPrefix: 'sk-ant-',
  keyHint: 'Starts with sk-ant-',
  models: [
    { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'Balanced — recommended' },
    { id: 'claude-opus-5', label: 'Opus 5', note: 'Most capable, pricier' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', note: 'Fastest, cheapest' },
  ],
  // Generation runs over many notes repeatedly, so the default is the model with
  // the best capability-per-cost rather than the most capable one.
  defaultModel: 'claude-sonnet-5',
  buildRequest,
  parseResponse,
  complete,
};
