import { classifyLlmError } from './errors';

describe('classifyLlmError', () => {
  it('maps rejected credentials to a message naming Settings', () => {
    expect(classifyLlmError(401, { error: { message: 'Invalid API key' } }).code).toBe('llm_unauthorized');
    expect(classifyLlmError(403, {}).code).toBe('llm_unauthorized');
  });

  it('does not offer a retry for a rejected key', () => {
    // Retrying the same bad key just wastes the user's time.
    expect(classifyLlmError(401, {}).retryable).toBe(false);
  });

  it('separates a rate limit from an exhausted balance on the same 429', () => {
    /*
      Both arrive as 429, and the right response differs completely: a rate
      limit clears by waiting, an empty balance never does. Telling someone to
      "try again shortly" when they are out of credit sends them in a loop.
    */
    const rateLimited = classifyLlmError(429, { error: { message: 'Rate limit reached' } });
    expect(rateLimited.code).toBe('llm_rate_limited');
    expect(rateLimited.retryable).toBe(true);

    const quota = classifyLlmError(429, {
      error: { type: 'insufficient_quota', message: 'You exceeded your current quota' },
    });
    expect(quota.code).toBe('llm_quota_exceeded');
    expect(quota.retryable).toBe(false);
  });

  it('detects an exhausted balance from the message alone', () => {
    const quota = classifyLlmError(429, {
      error: { message: 'Your credit balance is too low to access the API' },
    });
    expect(quota.code).toBe('llm_quota_exceeded');
  });

  it('treats 402 as an exhausted balance', () => {
    expect(classifyLlmError(402, { error: { message: 'credit balance too low' } }).code).toBe(
      'llm_quota_exceeded',
    );
  });

  it('recognises an exhausted balance on a 400, which is how Anthropic sends it', () => {
    /*
      Observed against the live API. The providers disagree about the status —
      OpenAI uses 429, Anthropic uses 400 — so keying off status alone files
      "you are out of money" under "the reply was unreadable".
    */
    const error = classifyLlmError(400, {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      },
    });
    expect(error.code).toBe('llm_quota_exceeded');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('credit balance');
  });

  it('still treats a genuinely malformed 400 as a bad request', () => {
    expect(classifyLlmError(400, { error: { message: 'model: nonsense not found' } }).code).toBe(
      'llm_bad_response',
    );
  });

  it('maps provider outages to a retryable error', () => {
    expect(classifyLlmError(500, {}).code).toBe('llm_server_error');
    expect(classifyLlmError(529, {}).retryable).toBe(true);
  });

  it('surfaces the provider message for a bad model name', () => {
    // The fix is in the user's hands, so the provider's own wording is more
    // useful than anything generic we could substitute.
    const error = classifyLlmError(404, { error: { message: 'model: nonsense-1 not found' } });
    expect(error.code).toBe('llm_bad_response');
    expect(error.message).toContain('nonsense-1');
    expect(error.retryable).toBe(false);
  });

  it('falls back rather than throwing on an unrecognised shape', () => {
    expect(classifyLlmError(418, null).code).toBe('unknown');
    expect(classifyLlmError(418, 'a string').code).toBe('unknown');
    expect(classifyLlmError(400, undefined).code).toBe('llm_bad_response');
  });

  it('never puts the request body in the user-facing message', () => {
    // The body of a failed request can echo prompt content; only the provider's
    // own message field is ever shown.
    const error = classifyLlmError(400, { error: { message: 'bad request' }, apiKey: 'sk-secret' });
    expect(error.message).not.toContain('sk-secret');
  });
});
