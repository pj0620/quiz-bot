import { AppError } from '../../lib/errors';
import { readApiKey } from './auth/secureKeyStore';
import type { LlmProviderDefinition } from './contract';
import { getLlmProvider } from './registry';
import { getJudgeModelFor, getLlmSettings, getModelFor } from './settings';
import type { LlmProviderId, LlmRole } from './types';

/**
 * Resolving "which provider, which key, which model" in one place.
 *
 * Every caller needs the same three things, and the interesting part is that
 * the answer now depends on WHAT the model is being asked to do. Writing
 * questions and marking a written answer can point at different providers and
 * different models, so the choice is made here once rather than at each call
 * site — the failure mode being a screen that quietly marks answers with the
 * expensive writing model because it forgot to ask for the judge.
 */

export type LlmCredentials = {
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
};

/** Which provider and model a role runs on, before any key is looked up. */
export type LlmTarget = { providerId: LlmProviderId; model: string };

/**
 * Null means "nothing configured for this job", which is a normal state: `mock`
 * generation and a judge left on `match` both land here legitimately.
 *
 * Note that marking is resolved independently of generation when a judge
 * provider is named — so questions written offline by `mock` can still be
 * marked by a real model, which is a genuinely useful combination and would be
 * unreachable if this fell back to the generator first.
 */
export function resolveTarget(role: LlmRole): LlmTarget | null {
  const { generatorId, judgeId } = getLlmSettings();

  if (role === 'judge' && judgeId !== 'match') {
    return { providerId: judgeId, model: getJudgeModelFor(judgeId) };
  }

  if (generatorId === 'mock') return null;
  return { providerId: generatorId, model: getModelFor(generatorId) };
}

async function credentialsFor(target: LlmTarget): Promise<LlmCredentials> {
  const provider = getLlmProvider(target.providerId);
  const apiKey = await readApiKey(target.providerId);
  if (!apiKey) {
    throw new AppError('llm_not_configured', {
      message: `Add an ${provider.label} API key in Settings before generating.`,
    });
  }
  return { provider, apiKey, model: target.model || provider.defaultModel };
}

/** Throws when the named provider has no key. Used where a run must not start. */
export async function resolveCredentials(providerId: LlmProviderId): Promise<LlmCredentials> {
  return credentialsFor({ providerId, model: getModelFor(providerId) });
}

/**
 * The provider configured for `role`, or null when there isn't one.
 *
 * Null is a normal state, not an error. Callers that must not interrupt the
 * user — marking an answer, above all — use this and quietly fall back rather
 * than throwing mid-quiz.
 */
export async function resolveCredentialsOrNull(role: LlmRole): Promise<LlmCredentials | null> {
  const target = resolveTarget(role);
  if (!target) return null;
  try {
    return await credentialsFor(target);
  } catch {
    return null;
  }
}
