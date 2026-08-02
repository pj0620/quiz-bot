import { AppError } from '../../lib/errors';

/**
 * Single mapping point from an LLM provider's HTTP response to an AppError.
 *
 * OpenAI and Anthropic both nest their message under `error.message`, and both
 * overload 429 for two conditions that need different UI: a rate limit clears
 * on its own, an exhausted balance does not. Telling someone to "try again
 * shortly" when their account is out of credit wastes their time, so the body
 * is inspected rather than trusting the status alone.
 */
export function classifyLlmError(status: number, body: unknown): AppError {
  const message = extractMessage(body);
  const type = extractType(body);

  if (status === 401 || status === 403) {
    return new AppError('llm_unauthorized', { cause: body });
  }

  /*
    Running out of credit is checked BEFORE the status is trusted, because the
    providers disagree about which status it is: OpenAI sends 429 (sharing it
    with ordinary rate limiting), Anthropic sends 400 (sharing it with genuinely
    malformed requests). Keying off the status alone files "you are out of
    money" under either "wait a moment" or "the reply was unreadable", and
    neither tells the user the one thing they need to do.
  */
  if (status === 400 || status === 402 || status === 429) {
    if (looksLikeQuota(type, message)) {
      return new AppError('llm_quota_exceeded', { message: message || undefined, cause: body });
    }
  }

  if (status === 429) {
    return new AppError('llm_rate_limited', { cause: body });
  }

  if (status >= 500) {
    return new AppError('llm_server_error', { cause: body });
  }

  /*
    A 400 here is almost always our fault or a bad model id, and the provider's
    own message names which. Surfacing it verbatim is more useful than a generic
    string, because the fix ("model not found") is in the user's hands.
  */
  if (status === 404 || status === 400) {
    return new AppError('llm_bad_response', {
      message: message || 'The provider rejected that request. Check the model name in Settings.',
      retryable: false,
      cause: body,
    });
  }

  return new AppError('unknown', { message: message || undefined, cause: body });
}

function looksLikeQuota(type: string, message: string): boolean {
  return (
    type === 'insufficient_quota' ||
    /quota|billing|credit balance|purchase credits|payment/i.test(message)
  );
}

function errorObject(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === 'object') return error as Record<string, unknown>;
  return body as Record<string, unknown>;
}

function extractMessage(body: unknown): string {
  const error = errorObject(body);
  const message = error?.message;
  return typeof message === 'string' ? message : '';
}

function extractType(body: unknown): string {
  const error = errorObject(body);
  const type = error?.type ?? error?.code;
  return typeof type === 'string' ? type : '';
}
