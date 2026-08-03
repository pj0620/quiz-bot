import { AppError } from '../../lib/errors';
import { readApiKey } from './auth/secureKeyStore';
import type { LlmProviderDefinition } from './contract';
import { getLlmProvider } from './registry';
import { getLlmSettings, getModelFor } from './settings';
import type { LlmProviderId } from './types';

/**
 * Resolving "which provider, which key, which model" in one place.
 *
 * Both callers — generating questions and grading a written answer — need the
 * same three things, and getting them out of step would mean grading silently
 * using a different model from the one the user picked in Settings.
 */

export type LlmCredentials = {
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
};

export async function resolveCredentials(providerId: LlmProviderId): Promise<LlmCredentials> {
  const provider = getLlmProvider(providerId);
  const apiKey = await readApiKey(providerId);
  if (!apiKey) {
    throw new AppError('llm_not_configured', {
      message: `Add an ${provider.label} API key in Settings before generating.`,
    });
  }
  return { provider, apiKey, model: getModelFor(providerId) || provider.defaultModel };
}

/**
 * The configured provider, or null when there isn't one.
 *
 * Null is a normal state, not an error: 'mock' is a legitimate choice and a key
 * can be absent. Callers that must not interrupt the user — grading, above all —
 * use this and quietly fall back rather than throwing mid-quiz.
 */
export async function resolveCredentialsOrNull(): Promise<LlmCredentials | null> {
  const { generatorId } = getLlmSettings();
  if (generatorId === 'mock') return null;
  try {
    return await resolveCredentials(generatorId);
  } catch {
    return null;
  }
}
