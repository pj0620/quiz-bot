import { createStore } from '../../lib/createStore';
import { readJsonSync, writeJson } from '../../lib/kv';
import { deleteApiKey, readApiKey, writeApiKey } from './auth/secureKeyStore';
import { getLlmProvider, isLlmProviderId, listLlmProviders } from './registry';
import type { GeneratorId, LlmProviderId, LlmSettings } from './types';

/**
 * Which generator runs, and which model each provider uses.
 *
 * Only non-secret preferences live here — keys are in the Keychain via
 * `auth/secureKeyStore.ts` and never touch kv. What kv does hold is whether a
 * key EXISTS, and even that is treated as a cache: `hydrateKeyStatus` corrects
 * it from the Keychain at startup, because the two stores can drift (a
 * reinstall clears one and not always the other).
 */

const SETTINGS_KEY = 'quizbot.llm.settings.v1';

export type KeyStatus = 'unknown' | 'set' | 'missing';

export type LlmState = {
  settings: LlmSettings;
  keyStatus: Record<LlmProviderId, KeyStatus>;
};

function defaultSettings(): LlmSettings {
  const models = {} as Record<LlmProviderId, string>;
  for (const provider of listLlmProviders()) models[provider.id] = provider.defaultModel;
  // Mock until a key is added: it costs nothing and works offline, so it's the
  // only safe thing to default to.
  return { generatorId: 'mock', models };
}

function isGeneratorId(value: unknown): value is GeneratorId {
  return value === 'mock' || isLlmProviderId(value);
}

/** Tolerates a partial or stale stored value rather than discarding all of it. */
function loadSettingsSync(): LlmSettings {
  const fallback = defaultSettings();
  const stored = readJsonSync<Partial<LlmSettings>>(SETTINGS_KEY);
  if (!stored) return fallback;

  const models = { ...fallback.models };
  if (stored.models && typeof stored.models === 'object') {
    for (const provider of listLlmProviders()) {
      const value = (stored.models as Record<string, unknown>)[provider.id];
      if (typeof value === 'string' && value.trim()) models[provider.id] = value.trim();
    }
  }

  return {
    generatorId: isGeneratorId(stored.generatorId) ? stored.generatorId : fallback.generatorId,
    models,
  };
}

function emptyKeyStatus(): Record<LlmProviderId, KeyStatus> {
  const status = {} as Record<LlmProviderId, KeyStatus>;
  for (const provider of listLlmProviders()) status[provider.id] = 'unknown';
  return status;
}

export const llmStore = createStore<LlmState>({
  settings: loadSettingsSync(),
  keyStatus: emptyKeyStatus(),
});

/** Fire-and-forget: a failed preference write must not break the screen. */
function persist(settings: LlmSettings): void {
  void writeJson(SETTINGS_KEY, settings).catch(() => undefined);
}

function updateSettings(update: (previous: LlmSettings) => LlmSettings): void {
  llmStore.set((state) => {
    const settings = update(state.settings);
    persist(settings);
    return { ...state, settings };
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function setGeneratorId(generatorId: GeneratorId): void {
  updateSettings((settings) => ({ ...settings, generatorId }));
}

export function setModel(providerId: LlmProviderId, model: string): void {
  const trimmed = model.trim() || getLlmProvider(providerId).defaultModel;
  updateSettings((settings) => ({
    ...settings,
    models: { ...settings.models, [providerId]: trimmed },
  }));
}

function setKeyStatus(providerId: LlmProviderId, status: KeyStatus): void {
  llmStore.set((state) =>
    state.keyStatus[providerId] === status
      ? state
      : { ...state, keyStatus: { ...state.keyStatus, [providerId]: status } },
  );
}

export async function saveApiKey(providerId: LlmProviderId, apiKey: string): Promise<void> {
  await writeApiKey(providerId, apiKey);
  setKeyStatus(providerId, 'set');
}

export async function removeApiKey(providerId: LlmProviderId): Promise<void> {
  await deleteApiKey(providerId);
  setKeyStatus(providerId, 'missing');

  // Leaving the generator pointed at a provider with no key would fail on the
  // next run with a confusing error; falling back to mock keeps it working.
  if (llmStore.get().settings.generatorId === providerId) setGeneratorId('mock');
}

/** Reads the Keychain once at startup so the UI can show a truthful state. */
export async function hydrateKeyStatus(): Promise<void> {
  await Promise.all(
    listLlmProviders().map(async (provider) => {
      try {
        const key = await readApiKey(provider.id);
        setKeyStatus(provider.id, key ? 'set' : 'missing');
      } catch {
        setKeyStatus(provider.id, 'missing');
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getLlmSettings(): LlmSettings {
  return llmStore.get().settings;
}

export function getModelFor(providerId: LlmProviderId): string {
  return llmStore.get().settings.models[providerId] ?? getLlmProvider(providerId).defaultModel;
}
