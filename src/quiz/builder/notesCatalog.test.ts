jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

type Listing = { files: { path: string; contentHash?: string }[]; truncated: boolean; revision?: string };

const mockListings: Record<string, Listing | Error> = {};
const mockListFiles = jest.fn(async (source: { id: string }) => {
  const listing = mockListings[source.id];
  if (listing instanceof Error) throw listing;
  return listing;
});

jest.mock('../../sources/registry', () => ({
  getSourceType: () => ({ provider: { listFiles: mockListFiles } }),
}));

let mockSources: { id: string }[] = [];
jest.mock('../../sources/store', () => ({
  getSources: () => mockSources,
}));

import { getCatalog, refreshCatalog, resetCatalog } from './notesCatalog';

function listing(paths: string[], overrides: Partial<Listing> = {}): Listing {
  return { files: paths.map((path) => ({ path, contentHash: `h:${path}` })), truncated: false, revision: 'rev', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCatalog();
  mockSources = [{ id: 'a' }, { id: 'b' }];
  mockListings.a = listing(['Books/One.md', 'README.md']);
  mockListings.b = listing(['History/Two.md']);
});

describe('refreshCatalog', () => {
  it('lists every source’s notes, leaving out housekeeping files', async () => {
    const catalog = await refreshCatalog();
    expect(catalog.notes.map((note) => `${note.sourceId}:${note.path}`)).toEqual(['a:Books/One.md', 'b:History/Two.md']);
    expect(catalog).toMatchObject({ status: 'ready', complete: true, revisions: { a: 'rev', b: 'rev' } });
  });

  it('serves a fresh listing from memory, and lists again when asked to', async () => {
    await refreshCatalog();
    await refreshCatalog();
    expect(mockListFiles).toHaveBeenCalledTimes(2);
    await refreshCatalog({ maxAgeMs: 0 });
    expect(mockListFiles).toHaveBeenCalledTimes(4);
  });

  it('joins callers onto one listing rather than starting another', async () => {
    await Promise.all([refreshCatalog(), refreshCatalog(), refreshCatalog()]);
    expect(mockListFiles).toHaveBeenCalledTimes(2);
  });

  /*
    A partial listing is fine to show, never to baseline against: the notes it
    is missing would look new the next time they were listed — and be written
    up unprompted.
  */
  it('is not complete when one source failed', async () => {
    mockListings.b = new Error('network is unreachable');
    const catalog = await refreshCatalog();
    expect(catalog).toMatchObject({ status: 'ready', complete: false });
    expect(catalog.notes).toHaveLength(1);
    expect(catalog.error).toBeInstanceOf(Error);
  });

  it('is not complete when a tree came back truncated', async () => {
    mockListings.a = listing(['Books/One.md'], { truncated: true });
    expect(await refreshCatalog()).toMatchObject({ status: 'ready', complete: false, truncated: true });
  });

  it('keeps the last good listing on screen when nothing answers', async () => {
    await refreshCatalog();
    mockListings.a = new Error('network is unreachable');
    mockListings.b = new Error('network is unreachable');
    const catalog = await refreshCatalog({ maxAgeMs: 0 });
    expect(catalog).toMatchObject({ status: 'error', complete: false });
    expect(catalog.notes).toHaveLength(2);
    expect(getCatalog()).toBe(catalog);
  });

  it('is complete and empty with no sources at all', async () => {
    mockSources = [];
    expect(await refreshCatalog()).toMatchObject({ status: 'ready', notes: [], complete: true });
  });
});
