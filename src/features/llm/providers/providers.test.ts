import { listLlmProviders, getLlmProvider, isLlmProviderId } from '../registry';
import type { CompletionInput } from '../types';
import * as anthropic from './anthropic';
import * as openai from './openai';

const input: CompletionInput = {
  apiKey: 'sk-test-key',
  model: 'test-model',
  system: 'You write quiz questions.',
  user: 'Here is a note.',
  maxTokens: 2048,
  json: true,
};

function bodyOf(spec: { body: string }): Record<string, unknown> {
  return JSON.parse(spec.body);
}

describe('registry', () => {
  it('registers every provider exactly once', () => {
    const ids = listLlmProviders().map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['openai', 'anthropic']));
  });

  it('gives every provider a default model that is one of its presets', () => {
    // Otherwise the settings screen opens with nothing selected and the preset
    // chips look broken.
    for (const provider of listLlmProviders()) {
      expect(provider.models.map((model) => model.id)).toContain(provider.defaultModel);
    }
  });

  it('gives every provider the metadata settings needs', () => {
    for (const provider of listLlmProviders()) {
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.icon.length).toBeGreaterThan(0);
      expect(provider.consoleUrl).toMatch(/^https:\/\//);
      expect(provider.keyPrefix.length).toBeGreaterThan(0);
    }
  });

  it('recognises only known ids', () => {
    expect(isLlmProviderId('openai')).toBe(true);
    expect(isLlmProviderId('gemini')).toBe(false);
    expect(isLlmProviderId(undefined)).toBe(false);
    expect(getLlmProvider('anthropic').id).toBe('anthropic');
  });
});

describe('anthropic request shaping', () => {
  const spec = anthropic.buildRequest(input);

  it('posts to the messages endpoint with the versioned key header', () => {
    expect(spec.url).toBe('https://api.anthropic.com/v1/messages');
    expect(spec.headers['x-api-key']).toBe('sk-test-key');
    expect(spec.headers['anthropic-version']).toBe('2023-06-01');
    // Bearer auth is OpenAI's scheme; sending it here fails as a 401.
    expect(spec.headers.authorization).toBeUndefined();
  });

  it('sends the system prompt as a top-level field, not a message', () => {
    const body = bodyOf(spec);
    expect(body.system).toBe(input.system);
    expect(body.messages).toEqual([{ role: 'user', content: input.user }]);
  });

  it('always sends max_tokens, which the API requires', () => {
    expect(bodyOf(spec).max_tokens).toBe(2048);
  });

  it('sends effort only to models known to accept it', () => {
    // The model field is free text; an unsupported parameter is a 400 on every
    // note of a run, so the gate fails closed on anything unrecognised.
    const supported = bodyOf(anthropic.buildRequest({ ...input, model: 'claude-sonnet-5', effort: 'medium' }));
    expect(supported.output_config).toEqual({ effort: 'medium' });

    const haiku = bodyOf(
      anthropic.buildRequest({ ...input, model: 'claude-haiku-4-5-20251001', effort: 'medium' }),
    );
    expect(haiku.output_config).toBeUndefined();

    const unknown = bodyOf(anthropic.buildRequest({ ...input, effort: 'medium' }));
    expect(unknown.output_config).toBeUndefined();
  });

  it('omits output_config entirely when no effort is asked for', () => {
    // Marking passes no effort; its requests must be byte-identical to before.
    expect(bodyOf(anthropic.buildRequest({ ...input, model: 'claude-sonnet-5' })).output_config).toBeUndefined();
  });
});

describe('anthropic response parsing', () => {
  it('reads text and usage', () => {
    const result = anthropic.parseResponse({
      content: [{ type: 'text', text: '{"questions":[]}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1204, output_tokens: 186 },
    });
    expect(result.text).toBe('{"questions":[]}');
    expect(result.stopReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 1204, outputTokens: 186 });
  });

  it('concatenates text blocks and skips non-text ones', () => {
    // Taking content[0] would return "" whenever a non-text block leads.
    const result = anthropic.parseResponse({
      content: [{ type: 'thinking' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    });
    expect(result.text).toBe('ab');
  });

  it('reports hitting the token cap as a length stop', () => {
    expect(anthropic.parseResponse({ stop_reason: 'max_tokens' }).stopReason).toBe('length');
  });

  it('does not throw on an empty or unexpected body', () => {
    expect(anthropic.parseResponse({}).text).toBe('');
    expect(anthropic.parseResponse(null).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('openai request shaping', () => {
  const spec = openai.buildRequest(input);

  it('posts to chat completions with bearer auth', () => {
    expect(spec.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(spec.headers.authorization).toBe('Bearer sk-test-key');
    expect(spec.headers['x-api-key']).toBeUndefined();
  });

  it('uses max_completion_tokens, not the deprecated max_tokens', () => {
    // The old field is rejected outright by reasoning models, so using it would
    // work on some models and 400 on others.
    const body = bodyOf(spec);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
  });

  it('sends the system prompt as the first message', () => {
    expect(bodyOf(spec).messages).toEqual([
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ]);
  });

  it('asks for JSON only when requested', () => {
    expect(bodyOf(spec).response_format).toEqual({ type: 'json_object' });
    expect(bodyOf(openai.buildRequest({ ...input, json: false })).response_format).toBeUndefined();
  });

  it('sends reasoning_effort only to models known to accept it', () => {
    const supported = bodyOf(openai.buildRequest({ ...input, model: 'gpt-5.6-terra', effort: 'medium' }));
    expect(supported.reasoning_effort).toBe('medium');

    // Non-reasoning models reject the parameter outright.
    const unknown = bodyOf(openai.buildRequest({ ...input, model: 'gpt-4o', effort: 'medium' }));
    expect(unknown.reasoning_effort).toBeUndefined();

    expect(bodyOf(openai.buildRequest({ ...input, model: 'gpt-5.6-terra' })).reasoning_effort).toBeUndefined();
  });
});

describe('openai response parsing', () => {
  it('reads text and usage', () => {
    const result = openai.parseResponse({
      choices: [{ message: { content: '{"questions":[]}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 900, completion_tokens: 120 },
    });
    expect(result.text).toBe('{"questions":[]}');
    expect(result.stopReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
  });

  it('reports a truncated completion as a length stop', () => {
    expect(
      openai.parseResponse({ choices: [{ message: { content: '{' }, finish_reason: 'length' }] }).stopReason,
    ).toBe('length');
  });

  it('does not throw on a refusal with null content', () => {
    expect(openai.parseResponse({ choices: [{ message: { content: null } }] }).text).toBe('');
    expect(openai.parseResponse({}).text).toBe('');
  });
});
