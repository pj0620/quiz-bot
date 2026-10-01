import { toCandidates } from '../generation/selectNotes';
import { describeCatalog, groupBySeries, suggestRequests } from './catalog';

const SOURCE = 'github-repo:1';

function vault(paths: string[]) {
  return toCandidates(
    SOURCE,
    paths.map((path) => ({ path })),
  );
}

const PATHS = [
  'Books/Thinking Fast and Slow 1 Characters.md',
  'Books/Thinking Fast and Slow 4 Associative machine.md',
  'Books/Thinking Fast and Slow 12 Anchors.md',
  'History/History of America 1 Colonies.md',
  'History/History of America 2 Revolution.md',
  'Books/Sapiens.md',
  'Lone Series 3 Only.md',
];

describe('groupBySeries', () => {
  it('collects numbered runs and lists everything else as loose notes', () => {
    const { series, loose } = groupBySeries(vault(PATHS));
    expect(series.map((group) => [group.name, group.count])).toEqual([
      ['Thinking Fast and Slow', 3],
      ['History of America', 2],
    ]);
    expect(series[0]).toMatchObject({ firstIndex: 1, lastIndex: 12, folders: ['Books'] });
    // A "series" of one is just a note.
    expect(loose.map((note) => note.title).sort()).toEqual(['Lone Series 3 Only', 'Sapiens']);
  });
});

describe('describeCatalog', () => {
  it('summarises series in a line each, with a real filename to match against', () => {
    const text = describeCatalog(vault(PATHS));
    expect(text).toContain('7 notes in total.');
    expect(text).toContain(
      '- "Thinking Fast and Slow" — 3 notes, numbered 1–12, in Books. e.g. "Thinking Fast and Slow 1 Characters"',
    );
    expect(text).toContain('- Books/Sapiens');
    expect(text).toContain('Folders: Books (4), History (2), (vault root) (1)');
  });

  it('counts the loose notes it does not name, rather than listing them all', () => {
    const many = vault(Array.from({ length: 30 }, (_, index) => `Inbox/Thought ${String.fromCharCode(65 + (index % 26))}${index}.md`));
    expect(describeCatalog(many, 10)).toContain('…and 20 more not listed.');
  });

  it('says plainly when there is nothing to list', () => {
    expect(describeCatalog([])).toBe('No notes could be listed right now.');
  });
});

describe('suggestRequests', () => {
  it('offers the biggest series first, then folders', () => {
    const suggestions = suggestRequests(vault(PATHS), 3);
    expect(suggestions.map((entry) => entry.label)).toEqual([
      'Thinking Fast and Slow · 3',
      'History of America · 2',
      'Books folder · 4',
    ]);
    expect(suggestions[0].request).toContain('Thinking Fast and Slow');
  });
});
