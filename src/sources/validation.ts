import type { InfoSource, InfoSourceType } from './types';

/**
 * Per-type persistence validators.
 *
 * Deliberately separate from `registry.ts`. The registry holds *behaviour*
 * (`SourceContentProvider`), so importing it drags the GitHub API client and
 * transitively `expo-secure-store` into whatever imports it — which would put
 * native modules on the synchronous store-hydration path and in every storage
 * unit test. Validation needs none of that, so it lives here with type-only
 * imports.
 *
 * The mapped type is the point: adding a member to `InfoSourceType` without a
 * validator here is a COMPILE ERROR, rather than silently dropping every
 * persisted row of the new type on load.
 */
type Validator<K extends InfoSourceType> = (source: Extract<InfoSource, { type: K }>) => boolean;

const VALIDATORS: { [K in InfoSourceType]: Validator<K> } = {
  'github-repo': (source) =>
    typeof source.repoId === 'number' &&
    typeof source.owner === 'string' &&
    typeof source.name === 'string' &&
    typeof source.fullName === 'string' &&
    typeof source.defaultBranch === 'string' &&
    typeof source.installationId === 'number',
};

function isKnownType(value: unknown): value is InfoSourceType {
  return typeof value === 'string' && value in VALIDATORS;
}

/** Fields every source carries, regardless of type. */
function hasValidBase(value: unknown): value is { id: string; type: InfoSourceType; addedAt: number } {
  if (!value || typeof value !== 'object') return false;
  const source = value as { id?: unknown; type?: unknown; addedAt?: unknown };
  return (
    typeof source.id === 'string' &&
    source.id.length > 0 &&
    isKnownType(source.type) &&
    typeof source.addedAt === 'number'
  );
}

export function isValidSource(value: unknown): value is InfoSource {
  if (!hasValidBase(value)) return false;
  const source = value as InfoSource;
  // Safe: `hasValidBase` narrowed `type` to a key of VALIDATORS, and the mapped
  // type guarantees the validator matches that member of the union.
  const validate = VALIDATORS[source.type] as (candidate: InfoSource) => boolean;
  return validate(source);
}
