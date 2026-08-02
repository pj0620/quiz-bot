import type { SourceFileEntry } from '../../sources/types';
import { coverageKey, type NoteCoverage } from './coverage';
import { foldersOf, folderOf, selectNotes, toCandidates, type NoteCandidate } from './selectNotes';

const SOURCE = 'github-repo:1';

function candidate(path: string, contentHash?: string): NoteCandidate {
  return {
    sourceId: SOURCE,
    path,
    contentHash,
    title: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    folder: folderOf(path),
  };
}

function covered(path: string, contentHash?: string, extra: Partial<NoteCoverage> = {}) {
  return {
    [coverageKey(SOURCE, path)]: {
      sourceId: SOURCE,
      path,
      contentHash,
      generatedAt: 1_760_000_000_000,
      questionCount: 4,
      ...extra,
    },
  };
}

function select(
  candidates: NoteCandidate[],
  coverage: Record<string, NoteCoverage> = {},
  options: { limit?: number; folders?: string[] } = {},
) {
  return selectNotes({
    candidates,
    coverage,
    limit: options.limit ?? 10,
    filters: options.folders ? { folders: options.folders } : undefined,
    seed: SOURCE,
  });
}

describe('toCandidates', () => {
  it('keeps only markdown notes and carries the content hash through', () => {
    const files: SourceFileEntry[] = [
      { path: 'History/Fort Sumter.md', contentHash: 'aaa' },
      { path: 'History/Pasted image.png', contentHash: 'bbb' },
      { path: 'src/index.ts', contentHash: 'ccc' },
      { path: '.obsidian/workspace.md', contentHash: 'ddd' },
    ];
    const candidates = toCandidates(SOURCE, files);

    expect(candidates.map((entry) => entry.path)).toEqual(['History/Fort Sumter.md']);
    expect(candidates[0].contentHash).toBe('aaa');
    expect(candidates[0].folder).toBe('History');
  });
});

describe('folderOf / foldersOf', () => {
  it('returns the top-level directory, or nothing at the root', () => {
    expect(folderOf('History/Civil War/Sumter.md')).toBe('History');
    expect(folderOf('Sumter.md')).toBeUndefined();
  });

  it('lists the folders that actually contain notes, sorted', () => {
    expect(
      foldersOf([candidate('History/a.md'), candidate('Books/b.md'), candidate('History/c.md'), candidate('d.md')]),
    ).toEqual(['Books', 'History']);
  });
});

describe('selectNotes — the duplicate-prevention guarantee', () => {
  it('skips a note already covered at the same hash', () => {
    /*
      The single most important assertion in this file. Edits keep old questions
      rather than replacing them, and a model rewords questions on every run, so
      re-reading an unchanged note would add near-duplicates that nothing
      downstream catches.
    */
    const result = select([candidate('History/a.md', 'sha-1')], covered('History/a.md', 'sha-1'));

    expect(result.selected).toHaveLength(0);
    expect(result.counts.covered).toBe(1);
  });

  it('picks a note back up once its content changes', () => {
    const result = select([candidate('History/a.md', 'sha-2')], covered('History/a.md', 'sha-1'));

    expect(result.selected.map((entry) => entry.path)).toEqual(['History/a.md']);
    expect(result.selected[0].reason).toBe('changed');
  });

  it('treats a note with no coverage entry as new', () => {
    const result = select([candidate('History/a.md', 'sha-1')]);
    expect(result.selected[0].reason).toBe('new');
    expect(result.counts.new).toBe(1);
  });

  it('treats a hash-less note as covered rather than re-reading it forever', () => {
    // A provider that cannot report content changes would otherwise duplicate
    // on every single run.
    const result = select([candidate('History/a.md')], covered('History/a.md'));
    expect(result.selected).toHaveLength(0);
    expect(result.counts.covered).toBe(1);
  });
});

describe('selectNotes — priority', () => {
  it('puts never-covered notes ahead of edited ones', () => {
    const result = select(
      [candidate('History/edited.md', 'sha-2'), candidate('History/fresh.md', 'sha-9')],
      covered('History/edited.md', 'sha-1'),
    );

    expect(result.selected.map((entry) => entry.reason)).toEqual(['new', 'changed']);
  });

  it('respects the limit', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(`History/n${i}.md`, `sha-${i}`));
    expect(select(candidates, {}, { limit: 5 }).selected).toHaveLength(5);
  });

  it('counts everything it saw, not just what it returned', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(`History/n${i}.md`, `sha-${i}`));
    const result = select(candidates, {}, { limit: 3 });

    expect(result.counts.total).toBe(20);
    expect(result.counts.new).toBe(20);
    expect(result.selected).toHaveLength(3);
  });

  it('orders deterministically so a cancelled run resumes predictably', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`History/n${i}.md`, `sha-${i}`));
    const first = select(candidates).selected.map((entry) => entry.path);
    const second = select(candidates).selected.map((entry) => entry.path);
    expect(second).toEqual(first);
  });
});

describe('selectNotes — failures', () => {
  it('keeps retrying a note that has failed a couple of times', () => {
    const result = select(
      [candidate('History/a.md', 'sha-1')],
      covered('History/a.md', undefined, { generatedAt: 0, failures: 2 }),
    );
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].reason).toBe('new');
  });

  it('gives up on a note that keeps failing', () => {
    // Otherwise one unparseable note is paid for on every single run.
    const result = select(
      [candidate('History/a.md', 'sha-1')],
      covered('History/a.md', undefined, { generatedAt: 0, failures: 3 }),
    );
    expect(result.selected).toHaveLength(0);
    expect(result.counts.skipped).toBe(1);
  });

  it('gives up on an edited note that keeps failing', () => {
    const result = select(
      [candidate('History/a.md', 'sha-2')],
      covered('History/a.md', 'sha-1', { failures: 3 }),
    );
    expect(result.selected).toHaveLength(0);
    expect(result.counts.skipped).toBe(1);
  });
});

describe('selectNotes — folder filter', () => {
  const candidates = [
    candidate('History/a.md', 'x'),
    candidate('Books/b.md', 'y'),
    candidate('root.md', 'z'),
  ];

  it('restricts to the chosen folders', () => {
    const result = select(candidates, {}, { folders: ['History'] });
    expect(result.selected.map((entry) => entry.path)).toEqual(['History/a.md']);
    expect(result.counts.filtered).toBe(2);
  });

  it('accepts several folders', () => {
    const result = select(candidates, {}, { folders: ['History', 'Books'] });
    expect(result.selected).toHaveLength(2);
  });

  it('selects everywhere when no folder is chosen', () => {
    expect(select(candidates).selected).toHaveLength(3);
  });
});
