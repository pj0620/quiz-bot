import { HttpError, requestJson } from '../../../lib/http';
import type { LlmProviderDefinition } from '../contract';
import { classifyLlmError } from '../errors';
import type { CompletionInput, CompletionResult, HttpRequestSpec, StopReason } from '../types';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** Generation is slower than a normal API call, so the 15s default is too tight. */
const TIMEOUT_MS = 90_000;

export function buildRequest(input: CompletionInput): HttpRequestSpec {
  return {
    url: ENDPOINT,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      /*
        `max_completion_tokens`, not `max_tokens`.

        The older field is deprecated and is rejected outright by reasoning
        models, so using it would work on some models and 400 on others — the
        worst kind of failure to debug from a settings screen.
      */
      max_completion_tokens: input.maxTokens,
      ...(input.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    }),
  };
}

type OpenAiResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function parseResponse(json: unknown): CompletionResult {
  const response = (json ?? {}) as OpenAiResponse;
  const choice = response.choices?.[0];

  return {
    text: choice?.message?.content ?? '',
    stopReason: toStopReason(choice?.finish_reason),
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

function toStopReason(value: string | undefined): StopReason {
  if (value === 'stop') return 'stop';
  if (value === 'length') return 'length';
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

export const openaiProvider: LlmProviderDefinition = {
  id: 'openai',
  label: 'OpenAI',
  icon: 'flash-outline',
  consoleUrl: 'https://platform.openai.com/api-keys',
  keyPrefix: 'sk-',
  keyHint: 'Starts with sk-',
  models: [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: 'Balanced — recommended' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: 'Most capable, pricier' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', note: 'Fastest, cheapest' },
  ],
  defaultModel: 'gpt-5.6-terra',
  buildRequest,
  parseResponse,
  complete,
};
