import { createStore } from '../../lib/createStore';
import { getItem, isStorageDegraded, readJsonSync, writeJson } from '../../lib/kv';
import { deleteApiKey, readApiKey, writeApiKey } from './auth/secureKeyStore';
import { getLlmProvider, isLlmProviderId, listLlmProviders } from './registry';
import type { GeneratorId, JudgeId, LlmProviderId, LlmSettings } from './types';

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

/**
 * The reader's generation notes, under their OWN key.
 *
 * They used to live only inside the settings blob above, and that is how they
 * were getting lost "on app updates": an update forces a cold launch, a cold
 * launch is when the very first synchronous read is most likely to fail
 * transiently, and a failed read hydrates default settings with an empty
 * guidance string. kv refuses the immediate next write — but its degraded
 * flag clears on the first read that succeeds, so the next time ANY setting
 * was changed, the whole defaulted blob (empty guidance included) was
 * persisted over the real one.
 *
 * Two defences now, either of which is sufficient on its own:
 *
 *  - Guidance is ALSO written here, alone, only by `setGuidance` — so no
 *    other mutation can ever clobber it, whatever state the blob is in. Loads
 *    prefer this copy; the blob's copy remains as a fallback and for older
 *    installs.
 *  - A load that happened while storage was degraded schedules an async
 *    re-read (`recoverSettingsFromStorage`), which puts the stored values
 *    back before anything the user has not touched this session gets a
 *    chance to overwrite them.
 */
const GUIDANCE_KEY = 'quizbot.llm.guidance.v1';

/**
 * Notes in flight at once.
 *
 * Two by default rather than one, because a generation run is almost entirely
 * spent waiting on a provider — and rather than four, because every note is at
 * least one request and a long one is several, so the request rate is a
 * multiple of this number, not equal to it. Two halves the wall-clock time of a
 * run while staying comfortably inside every provider's entry-level rate limit.
 */
export const DEFAULT_CONCURRENCY = 2;

/**
 * Above this, rate limiting becomes the bottleneck instead of the network, and
 * a 429 costs a note rather than just some time.
 */
export const MAX_CONCURRENCY = 4;

export const CONCURRENCY_CHOICES = [1, 2, 3, 4] as const;

export function clampConcurrency(value: unknown): number {
  const parsed = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, parsed));
}

/**
 * Ceiling on the reader's own generation instructions.
 *
 * Generous — this is a paragraph or two of taste, not an essay — but bounded,
 * because it rides on EVERY request in a run. A field with no limit is one
 * pasted note away from doubling the input cost of every note in the vault, and
 * from crowding out the note itself in the model's attention.
 */
export const MAX_GUIDANCE_CHARS = 2_000;

export function clampGuidance(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_GUIDANCE_CHARS) : '';
}

export type KeyStatus = 'unknown' | 'set' | 'missing';

export type LlmState = {
  settings: LlmSettings;
  keyStatus: Record<LlmProviderId, KeyStatus>;
};

function defaultSettings(): LlmSettings {
  const models = {} as Record<LlmProviderId, string>;
  const judgeModels = {} as Record<LlmProviderId, string>;
  for (const provider of listLlmProviders()) {
    models[provider.id] = provider.defaultModel;
    judgeModels[provider.id] = provider.defaultJudgeModel ?? provider.defaultModel;
  }
  // Mock until a key is added: it costs nothing and works offline, so it's the
  // only safe thing to default to.
  return {
    generatorId: 'mock',
    models,
    // Marking follows the generator until the reader says otherwise, which is
    // exactly what the app did before this was a choice.
    judgeId: 'match',
    judgeModels,
    concurrency: DEFAULT_CONCURRENCY,
    guidance: '',
  };
}

function isGeneratorId(value: unknown): value is GeneratorId {
  return value === 'mock' || isLlmProviderId(value);
}

function isJudgeId(value: unknown): value is JudgeId {
  return value === 'match' || isLlmProviderId(value);
}

/**
 * One provider-keyed map of model names, merged over its defaults.
 *
 * Shared by the writing and marking maps: both are "a string per provider,
 * where anything missing, blank or the wrong type falls back", and having that
 * rule written twice is how the two quietly drift apart.
 */
function mergeModels(
  stored: unknown,
  fallback: Record<LlmProviderId, string>,
): Record<LlmProviderId, string> {
  const models = { ...fallback };
  if (!stored || typeof stored !== 'object') return models;

  for (const provider of listLlmProviders()) {
    const value = (stored as Record<string, unknown>)[provider.id];
    if (typeof value === 'string' && value.trim()) models[provider.id] = value.trim();
  }
  return models;
}

/** Tolerates a partial or stale stored value rather than discarding all of it. */
function settingsFromStored(
  stored: Partial<LlmSettings> | null,
  guidanceOverride: string | null,
): LlmSettings {
  const fallback = defaultSettings();
  if (!stored) {
    return guidanceOverride === null ? fallback : { ...fallback, guidance: clampGuidance(guidanceOverride) };
  }

  return {
    generatorId: isGeneratorId(stored.generatorId) ? stored.generatorId : fallback.generatorId,
    models: mergeModels(stored.models, fallback.models),
    // An install from before marking was separable has neither field, and lands
    // on 'match' — which is the behaviour it already had.
    judgeId: isJudgeId(stored.judgeId) ? stored.judgeId : fallback.judgeId,
    judgeModels: mergeModels(stored.judgeModels, fallback.judgeModels),
    // Clamped rather than validated: a value stored by an older build (where
    // the field didn't exist) or an out-of-range one should land on something
    // workable, not send the whole settings object back to defaults.
    concurrency: clampConcurrency(stored.concurrency ?? fallback.concurrency),
    // The dedicated key wins over the blob's copy — see GUIDANCE_KEY.
    guidance: guidanceOverride === null ? clampGuidance(stored.guidance) : clampGuidance(guidanceOverride),
  };
}

type LoadedSettings = {
  settings: LlmSettings;
  /** True when a read THREW during hydration, so what loaded may be a fallback. */
  recover: boolean;
  /** True when the dedicated guidance key held nothing readable. */
  guidanceKeyMissing: boolean;
};

function loadSettingsSync(): LoadedSettings {
  /*
    `isStorageDegraded` reflects the most recent synchronous read, so checking
    it immediately after each read is what tells "nothing stored" apart from
    "the read failed" — the difference between a fresh install and a cold
    launch that must be recovered.
  */
  const stored = readJsonSync<Partial<LlmSettings>>(SETTINGS_KEY);
  const settingsFailed = stored === null && isStorageDegraded();
  const ownGuidance = readJsonSync<string>(GUIDANCE_KEY);
  const guidanceFailed = ownGuidance === null && isStorageDegraded();

  return {
    settings: settingsFromStored(stored, typeof ownGuidance === 'string' ? ownGuidance : null),
    recover: guidanceFailed || settingsFailed,
    guidanceKeyMissing: ownGuidance === null,
  };
}

function emptyKeyStatus(): Record<LlmProviderId, KeyStatus> {
  const status = {} as Record<LlmProviderId, KeyStatus>;
  for (const provider of listLlmProviders()) status[provider.id] = 'unknown';
  return status;
}

const loaded = loadSettingsSync();

export const llmStore = createStore<LlmState>({
  settings: loaded.settings,
  keyStatus: emptyKeyStatus(),
});

/*
  What the user changed THIS session. Recovery must never overwrite a value
  the user has since set by hand — their action is newer than anything on
  disk — so each side of the store tracks its own touch.
*/
let settingsTouched = false;
let guidanceTouched = false;

/**
 * Puts stored settings back after a hydration that read nothing because the
 * read FAILED (not because nothing was stored). Retries on a backoff, since
 * the usual cause — the database briefly unopenable at cold launch — clears
 * itself within moments. Returns whether anything was recovered.
 *
 * Async reads go straight to storage and bypass the degraded flag, so this
 * cannot be fooled by other modules' reads succeeding in the meantime.
 */
export async function recoverSettingsFromStorage(
  delays: readonly number[] = [500, 2_000, 8_000],
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    const [rawSettings, rawGuidance] = await Promise.all([
      getItem(SETTINGS_KEY),
      getItem(GUIDANCE_KEY),
    ]);
    const stored = parseJson<Partial<LlmSettings>>(rawSettings);
    const storedGuidance = parseJson<string>(rawGuidance);

    if (stored !== null || storedGuidance !== null) {
      llmStore.set((state) => {
        const current = state.settings;
        const base = !settingsTouched && stored ? settingsFromStored(stored, null) : current;
        const recovered =
          typeof storedGuidance === 'string'
            ? storedGuidance
            : typeof stored?.guidance === 'string'
              ? stored.guidance
              : null;
        const guidance =
          !guidanceTouched && recovered !== null ? clampGuidance(recovered) : current.guidance;
        // NOT persisted: this is what storage already holds.
        return { ...state, settings: { ...base, guidance } };
      });
      return true;
    }

    if (attempt >= delays.length) return false;
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

if (loaded.recover) {
  void recoverSettingsFromStorage().catch(() => undefined);
} else if (loaded.guidanceKeyMissing && loaded.settings.guidance) {
  // A healthy load from a pre-split install: the note exists only inside the
  // blob. Copy it to its own key now, so it is protected from here on.
  void writeJson(GUIDANCE_KEY, loaded.settings.guidance).catch(() => undefined);
}

/** Fire-and-forget: a failed preference write must not break the screen. */
function persist(settings: LlmSettings): void {
  void writeJson(SETTINGS_KEY, settings).catch(() => undefined);
}

function updateSettings(update: (previous: LlmSettings) => LlmSettings): void {
  settingsTouched = true;
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

export function setConcurrency(concurrency: number): void {
  updateSettings((settings) => ({ ...settings, concurrency: clampConcurrency(concurrency) }));
}

/**
 * Stored verbatim apart from the length cap — not trimmed, not tidied.
 *
 * This is a multi-line field someone types into over several sittings, and
 * trimming on every keystroke would eat the newline the moment they pressed
 * return. `buildSystemPrompt` trims when it sends.
 *
 * Written to TWO places: the settings blob (where it has always lived) and
 * its own key, which nothing else ever writes — the redundancy that makes
 * the note survive whatever happens to the blob. See GUIDANCE_KEY.
 */
export function setGuidance(guidance: string): void {
  guidanceTouched = true;
  const clamped = clampGuidance(guidance);
  updateSettings((settings) => ({ ...settings, guidance: clamped }));
  void writeJson(GUIDANCE_KEY, clamped).catch(() => undefined);
}

export function setModel(providerId: LlmProviderId, model: string): void {
  const trimmed = model.trim() || getLlmProvider(providerId).defaultModel;
  updateSettings((settings) => ({
    ...settings,
    models: { ...settings.models, [providerId]: trimmed },
  }));
}

export function setJudgeId(judgeId: JudgeId): void {
  updateSettings((settings) => ({ ...settings, judgeId }));
}

export function setJudgeModel(providerId: LlmProviderId, model: string): void {
  const provider = getLlmProvider(providerId);
  const trimmed = model.trim() || provider.defaultJudgeModel || provider.defaultModel;
  updateSettings((settings) => ({
    ...settings,
    judgeModels: { ...settings.judgeModels, [providerId]: trimmed },
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

  // Same reasoning for marking, one step quieter: a judge with no key doesn't
  // fail loudly, it silently sends every written answer back to self-grading.
  if (llmStore.get().settings.judgeId === providerId) setJudgeId('match');
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

export function getJudgeId(): JudgeId {
  return llmStore.get().settings.judgeId ?? 'match';
}

export function getJudgeModelFor(providerId: LlmProviderId): string {
  const provider = getLlmProvider(providerId);
  return (
    llmStore.get().settings.judgeModels?.[providerId] ??
    provider.defaultJudgeModel ??
    provider.defaultModel
  );
}

export function getConcurrency(): number {
  return clampConcurrency(llmStore.get().settings.concurrency);
}

export function getGuidance(): string {
  return llmStore.get().settings.guidance ?? '';
}
