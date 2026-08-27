// storage.ts imports the kv layer, which pulls in expo-sqlite's native module —
// unresolvable under jest and irrelevant to these pure-function tests.
jest.mock('../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
}));

import { dedupeById, parseSources } from './storage';
import { githubSourceId, type InfoSource } from './types';

function source(overrides: Partial<InfoSource> = {}): InfoSource {
  return {
    id: githubSourceId(1),
    type: 'github-repo',
    addedAt: 1_700_000_000_000,
    repoId: 1,
    owner: 'octocat',
    name: 'hello-world',
    fullName: 'octocat/hello-world',
    defaultBranch: 'main',
    private: false,
    installationId: 42,
    accountLogin: 'octocat',
    ...overrides,
  };
}

describe('parseSources', () => {
  it('round-trips a valid envelope', () => {
    const sources = [source()];
    expect(parseSources({ version: 1, sources })).toEqual(sources);
  });

  it('returns empty for null, garbage, and non-objects', () => {
    expect(parseSources(null)).toEqual([]);
    expect(parseSources('nope')).toEqual([]);
    expect(parseSources(42)).toEqual([]);
  });

  it('discards an unknown version rather than guessing at a migration', () => {
    expect(parseSources({ version: 99, sources: [source()] })).toEqual([]);
  });

  it('discards a missing or non-array sources field', () => {
    expect(parseSources({ version: 1 })).toEqual([]);
    expect(parseSources({ version: 1, sources: 'x' })).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const parsed = parseSources({
      version: 1,
      sources: [source(), { id: 'x' }, null, { ...source({ repoId: undefined as never }) }],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fullName).toBe('octocat/hello-world');
  });

  it('dedupes on read', () => {
    const parsed = parseSources({ version: 1, sources: [source(), source()] });
    expect(parsed).toHaveLength(1);
  });
});

describe('dedupeById', () => {
  it('keeps the first occurrence and preserves order', () => {
    const a = source({ id: 'a', repoId: 1 });
    const b = source({ id: 'b', repoId: 2 });
    const aDuplicate = source({ id: 'a', repoId: 1, fullName: 'other/name' });

    const result = dedupeById([a, b, aDuplicate]);
    expect(result.map((s) => s.id)).toEqual(['a', 'b']);
    expect(result[0].fullName).toBe('octocat/hello-world');
  });
});

describe('githubSourceId', () => {
  it('is deterministic, so re-adding the same repo dedupes', () => {
    expect(githubSourceId(123)).toBe('github-repo:123');
    expect(githubSourceId(123)).toBe(githubSourceId(123));
  });
});
