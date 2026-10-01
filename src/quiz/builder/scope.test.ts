import type { NoteCandidate } from '../generation/selectNotes';
import { toCandidates } from '../generation/selectNotes';
import {
  compareBookOrder,
  describeScope,
  isUnbounded,
  matchesScope,
  normalizeForMatch,
  resolveScope,
} from './scope';
import { emptyScope, type PlanScope } from './types';

const SOURCE = 'github-repo:1';

function notes(...paths: string[]): NoteCandidate[] {
  return toCandidates(
    SOURCE,
    paths.map((path) => ({ path, contentHash: `h-${path}` })),
  );
}

function scope(overrides: Partial<PlanScope>): PlanScope {
  return { ...emptyScope(), ...overrides };
}

const VAULT = notes(
  'Books/Thinking Fast and Slow 12 Anchors.md',
  'Books/Thinking Fast and Slow 4 The associative machine.md',
  'Books/Thinking Fast and Slow 1 The characters of the story.md',
  'Books/Sapiens.md',
  'History/History of America 1 Colonies.md',
  'History/History of America 12 Revolution.md',
  'Inbox/Smart grid ideas.md',
);

function titles(list: readonly NoteCandidate[]): string[] {
  return list.map((note) => note.title);
}

describe('normalizeForMatch', () => {
  it('flattens case, separators and the extension', () => {
    expect(normalizeForMatch('Books/Thinking-Fast_and Slow 4.md')).toBe('books thinking fast and slow 4');
  });

  it('strips accents, so a term matches however the vault spells it', () => {
    expect(normalizeForMatch('Café Society')).toBe('cafe society');
  });

  /*
    A vault in another script must be matchable at all. Flattening every
    non-Latin letter to a separator would turn its filenames into blank space.
  */
  it('keeps letters from other scripts, splitting only on punctuation', () => {
    expect(normalizeForMatch('Книги/Мышление — быстрое и медленное 3.md')).toBe('книги мышление быстрое и медленное 3');
    expect(normalizeForMatch('思考，快与慢')).toBe('思考 快与慢');
  });
});

describe('matchesScope', () => {
  it('matches every note when nothing narrows it', () => {
    expect(VAULT.every((note) => matchesScope(note, emptyScope()))).toBe(true);
  });

  it('picks out a series by a phrase in its filenames', () => {
    const matched = VAULT.filter((note) => matchesScope(note, scope({ terms: ['Thinking Fast and Slow'] })));
    expect(matched).toHaveLength(3);
  });

  it('matches phrases case-insensitively and across punctuation', () => {
    const matched = VAULT.filter((note) => matchesScope(note, scope({ terms: ['thinking-fast-AND-slow'] })));
    expect(matched).toHaveLength(3);
  });

  /*
    Whole words only. Substring matching would pull every note about the
    Smart grid into a plan about art, and chapter 12 into a plan about
    chapter 1 — both silently, and both billed.
  */
  it('matches whole words, never fragments of them', () => {
    expect(VAULT.filter((note) => matchesScope(note, scope({ terms: ['art'] })))).toHaveLength(0);
    const chapterOne = VAULT.filter((note) =>
      matchesScope(note, scope({ terms: ['History of America 1'] })),
    );
    expect(titles(chapterOne)).toEqual(['History of America 1 Colonies']);
  });

  it('treats several phrases as any-of', () => {
    const matched = VAULT.filter((note) => matchesScope(note, scope({ terms: ['Sapiens', 'Smart grid'] })));
    expect(titles(matched).sort()).toEqual(['Sapiens', 'Smart grid ideas']);
  });

  it('rules a note out with an exclude phrase even when a term matched it', () => {
    const matched = VAULT.filter((note) =>
      matchesScope(note, scope({ terms: ['Thinking Fast and Slow'], excludeTerms: ['Anchors'] })),
    );
    expect(matched).toHaveLength(2);
  });

  it('restricts to top-level folders, ignoring their case', () => {
    const matched = VAULT.filter((note) => matchesScope(note, scope({ folders: ['history'] })));
    expect(matched).toHaveLength(2);
  });

  it('restricts to sources', () => {
    const other = notes('Books/Sapiens.md').map((note) => ({ ...note, sourceId: 'github-repo:2' }));
    expect(matchesScope(other[0], scope({ sourceIds: [SOURCE] }))).toBe(false);
    expect(matchesScope(VAULT[3], scope({ sourceIds: [SOURCE] }))).toBe(true);
  });

  it('lets a hand-picked note in past every rule', () => {
    const sapiens = VAULT.find((note) => note.title === 'Sapiens')!;
    const rule = scope({ terms: ['Thinking Fast and Slow'], include: [`${SOURCE}:${sapiens.path}`] });
    expect(matchesScope(sapiens, rule)).toBe(true);
  });

  it('keeps a hand-excluded note out even when a rule matches it', () => {
    const anchors = VAULT[0];
    const rule = scope({ terms: ['Thinking Fast and Slow'], exclude: [`${SOURCE}:${anchors.path}`] });
    expect(matchesScope(anchors, rule)).toBe(false);
  });

  /*
    No rule plus hand picks means ONLY those notes. Read the other way, three
    ticked notes would mean the whole vault — the opposite of what ticking them
    was for.
  */
  /*
    "Everything except the dailies" is a rule. Ticking one daily back in must
    add it to everything else, not shrink the plan to that one note.
  */
  it('treats an exclude-only scope as a rule that hand picks add to', () => {
    const lone = VAULT.find((note) => note.title === 'Smart grid ideas')!;
    const rule = scope({ excludeTerms: ['Smart grid'], include: [`${SOURCE}:${lone.path}`] });
    expect(VAULT.filter((note) => matchesScope(note, rule))).toHaveLength(VAULT.length);
    expect(describeScope(rule)).toBe('Every note except “Smart grid” (+1 by hand)');
  });

  it('treats hand picks with no rule as the whole selection', () => {
    const sapiens = VAULT.find((note) => note.title === 'Sapiens')!;
    const rule = scope({ include: [`${SOURCE}:${sapiens.path}`] });
    expect(titles(VAULT.filter((note) => matchesScope(note, rule)))).toEqual(['Sapiens']);
    expect(isUnbounded(rule)).toBe(false);
  });
});

describe('resolveScope and book order', () => {
  /*
    The point of book order: a plan works through a book from chapter one, and
    "12" sorts after "4" — which a plain string sort gets backwards.
  */
  it('orders a series by its running number, not alphabetically', () => {
    const matched = resolveScope(VAULT, scope({ terms: ['Thinking Fast and Slow'] }));
    expect(titles(matched)).toEqual([
      'Thinking Fast and Slow 1 The characters of the story',
      'Thinking Fast and Slow 4 The associative machine',
      'Thinking Fast and Slow 12 Anchors',
    ]);
  });

  it('groups series together before ordering within them', () => {
    const ordered = [...VAULT].sort(compareBookOrder).map((note) => note.title);
    expect(ordered.indexOf('History of America 1 Colonies')).toBeLessThan(
      ordered.indexOf('History of America 12 Revolution'),
    );
    expect(ordered.indexOf('Thinking Fast and Slow 1 The characters of the story')).toBeLessThan(
      ordered.indexOf('Thinking Fast and Slow 12 Anchors'),
    );
  });
});

describe('resolveScope caching', () => {
  /*
    Screens resolve a plan's scope on every render that touches the plan, and
    a batch touches it several times per note. Re-sorting the vault each time
    is wasted work on the JS thread mid-run.
  */
  it('returns the same resolution for the same listing and scope', () => {
    const rule = scope({ terms: ['Thinking Fast and Slow'] });
    const first = resolveScope(VAULT, rule);
    expect(resolveScope(VAULT, { ...rule })).toBe(first);
  });

  it('resolves afresh for a different scope or a new listing', () => {
    const first = resolveScope(VAULT, scope({ terms: ['Thinking Fast and Slow'] }));
    expect(resolveScope(VAULT, scope({ terms: ['History of America'] }))).not.toBe(first);
    expect(resolveScope([...VAULT], scope({ terms: ['Thinking Fast and Slow'] }))).not.toBe(first);
    expect(resolveScope([...VAULT], scope({ terms: ['Thinking Fast and Slow'] }))).toEqual(first);
  });
});

describe('describeScope', () => {
  it('names the phrases a plan matches on', () => {
    expect(describeScope(scope({ terms: ['Thinking Fast and Slow'] }))).toBe(
      'Notes matching “Thinking Fast and Slow”',
    );
  });

  it('says "every note" when nothing narrows it', () => {
    expect(describeScope(emptyScope())).toBe('Every note');
  });

  it('mentions folders, exclusions and hand adjustments', () => {
    expect(
      describeScope(
        scope({
          terms: ['Kahneman'],
          folders: ['Books'],
          excludeTerms: ['Conclusion'],
          include: ['a'],
          exclude: ['b', 'c'],
        }),
      ),
    ).toBe('Notes matching “Kahneman” in Books except “Conclusion” (+1 by hand, 2 left out)');
  });

  it('describes a hand-picked selection as exactly that', () => {
    expect(describeScope(scope({ include: ['a', 'b'] }))).toBe('2 notes you picked');
  });
});
