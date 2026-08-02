import { readJsonSync, writeJson } from './kv';

/**
 * Shared envelope persistence, factored out of sources/storage.ts so the four
 * new quiz stores don't each reimplement (and each subtly get wrong) version
 * checking and per-item validation.
 *
 * Policy, unchanged from the original: an unknown version is DISCARDED, never
 * migrated, and one malformed row is dropped without losing the rest of the
 * batch.
 */
export type Envelope<T> = {
  version: number;
  items: T[];
};

export type PersistConfig<T> = {
  key: string;
  version: number;
  /** Per-item type guard. Rows failing this are dropped individually. */
  isValid: (value: unknown) => value is T;
};

export function parseEnvelope<T>(raw: unknown, config: PersistConfig<T>): T[] {
  if (!raw || typeof raw !== 'object') return [];
  const envelope = raw as Partial<Envelope<T>>;
  if (envelope.version !== config.version) return [];
  if (!Array.isArray(envelope.items)) return [];
  return envelope.items.filter(config.isValid);
}

/** Synchronous load, so stores hydrate on first render with no empty flash. */
export function loadSync<T>(config: PersistConfig<T>): T[] {
  return parseEnvelope(readJsonSync<Envelope<T>>(config.key), config);
}

export async function save<T>(items: T[], config: PersistConfig<T>): Promise<void> {
  await writeJson(config.key, { version: config.version, items } satisfies Envelope<T>);
}

/**
 * Coalesces bursts of writes.
 *
 * The whole question bank lives in one kv value, so answering a question would
 * otherwise re-serialize thousands of rows on every tap. Callers stay
 * fire-and-forget; the in-memory store remains authoritative either way.
 */
export function createDebouncedSaver<T>(config: PersistConfig<T>, delayMs = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T[] | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const items = pending;
    pending = null;
    void save(items, config).catch(() => undefined);
  };

  return {
    schedule(items: T[]): void {
      pending = items;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    /** Force an immediate write — used when a session completes. */
    flush,
  };
}

/** Keyed variant, for review states which are a map rather than a list. */
export type RecordEnvelope<T> = {
  version: number;
  items: Record<string, T>;
};

export function parseRecordEnvelope<T>(
  raw: unknown,
  config: PersistConfig<T>,
): Record<string, T> {
  if (!raw || typeof raw !== 'object') return {};
  const envelope = raw as Partial<RecordEnvelope<T>>;
  if (envelope.version !== config.version) return {};
  const items = envelope.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) return {};

  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(items)) {
    if (config.isValid(value)) result[key] = value;
  }
  return result;
}

export function loadRecordSync<T>(config: PersistConfig<T>): Record<string, T> {
  return parseRecordEnvelope(readJsonSync<RecordEnvelope<T>>(config.key), config);
}

export async function saveRecord<T>(
  items: Record<string, T>,
  config: PersistConfig<T>,
): Promise<void> {
  await writeJson(config.key, { version: config.version, items });
}

export function createDebouncedRecordSaver<T>(config: PersistConfig<T>, delayMs = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Record<string, T> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const items = pending;
    pending = null;
    void saveRecord(items, config).catch(() => undefined);
  };

  return {
    schedule(items: Record<string, T>): void {
      pending = items;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
