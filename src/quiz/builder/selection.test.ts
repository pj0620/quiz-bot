import { coverageKey } from '../generation/coverage';
import { toCandidates, type NoteCandidate } from '../generation/selectNotes';
import { resolveScope } from './scope';
import {
  freshNotes,
  isFresh,
  notesForSize,
  orderForBatch,
  pickSampleNotes,
  planProgress,
} from './selection';
import { emptyScope, MAX_NOTE_FAILURES, type PlanNoteCoverage } from './types';

const SOURCE = 'github-repo:1';

function book(count: number): readonly NoteCandidate[] {
  const files = Array.from({ length: count }, (_, index) => ({
    path: `Books/Thinking Fast and Slow ${index + 1} Chapter.md`,
    contentHash: `hash-${index + 1}`,
  }));
  return resolveScope(toCandidates(SOURCE, files), emptyScope());
}

function key(note: NoteCandidate): string {
  return coverageKey(note.sourceId, note.path);
}

function covered(passes: number, note: NoteCandidate, extra: Partial<PlanNoteCoverage> = {}) {
  return { [key(note)]: { contentHash: note.contentHash, passes, questionCount: 5, lastAt: 1, ...extra } };
}

/** Every note acknowledged at its current version — a plan's baseline. */
function baseline(notes: readonly NoteCandidate[]): Record<string, string> {
  return Object.fromEntries(notes.map((note) => [key(note), note.contentHash ?? '']));
}

describe('isFresh', () => {
  const [note] = book(1);

  it('calls a note the plan has never acknowledged fresh', () => {
    expect(isFresh(note, {})).toBe(true);
  });

  it('calls an acknowledged, unchanged note not fresh', () => {
    expect(isFresh(note, baseline([note]))).toBe(false);
  });

  it('calls a note edited since it was acknowledged fresh', () => {
    expect(isFresh(note, { [key(note)]: 'an-older-hash' })).toBe(true);
  });

  /*
    With no hash on one side, "changed" cannot be known — and treating that as
    fresh would bill the reader for the same note on every single check.
  */
  it('never calls a note fresh because a hash is missing', () => {
    expect(isFresh(note, { [key(note)]: '' })).toBe(false);
    expect(isFresh({ ...note, contentHash: undefined }, { [key(note)]: 'x' })).toBe(false);
  });
});

describe('orderForBatch', () => {
  it('works through the backlog in book order', () => {
    const notes = book(5);
    const order = orderForBatch({ matched: notes, coverage: {}, seen: baseline(notes), depth: 1 });
    expect(order.map((note) => note.tier)).toEqual(['backlog', 'backlog', 'backlog', 'backlog', 'backlog']);
    expect(order[0].title).toBe('Thinking Fast and Slow 1 Chapter');
  });

  /*
    The reason the tier exists: a note written yesterday is what the reader is
    studying NOW, so it jumps ahead of a backlog that may be months deep.
  */
  it('puts a note that turned up after the baseline first', () => {
    const notes = book(5);
    const seen = baseline(notes.slice(0, 4));
    const order = orderForBatch({ matched: notes, coverage: {}, seen, depth: 1 });
    expect(order[0]).toMatchObject({ title: 'Thinking Fast and Slow 5 Chapter', tier: 'fresh' });
  });

  it('skips notes already read as many times as the depth allows', () => {
    const notes = book(3);
    const coverage = { ...covered(1, notes[0]), ...covered(1, notes[1]) };
    const order = orderForBatch({ matched: notes, coverage, seen: baseline(notes), depth: 1 });
    expect(order.map((note) => note.title)).toEqual(['Thinking Fast and Slow 3 Chapter']);
  });

  it('offers a second pass, least-read first, once depth allows it', () => {
    const notes = book(3);
    const coverage = { ...covered(2, notes[0]), ...covered(1, notes[1]), ...covered(1, notes[2]) };
    const order = orderForBatch({ matched: notes, coverage, seen: baseline(notes), depth: 3 });
    expect(order.map((note) => [note.title, note.tier])).toEqual([
      ['Thinking Fast and Slow 2 Chapter', 'deeper'],
      ['Thinking Fast and Slow 3 Chapter', 'deeper'],
      ['Thinking Fast and Slow 1 Chapter', 'deeper'],
    ]);
  });

  it('re-reads a covered note that changed, whatever the depth', () => {
    const notes = book(2);
    const coverage = { ...covered(1, notes[0]), ...covered(1, notes[1]) };
    const seen = { ...baseline(notes), [key(notes[1])]: 'stale-hash' };
    const order = orderForBatch({ matched: notes, coverage, seen, depth: 1 });
    expect(order.map((note) => [note.title, note.tier])).toEqual([['Thinking Fast and Slow 2 Chapter', 'fresh']]);
  });

  it('leaves alone a note that keeps failing', () => {
    const notes = book(2);
    const coverage = { [key(notes[0])]: { passes: 0, questionCount: 0, lastAt: 1, failures: MAX_NOTE_FAILURES } };
    const order = orderForBatch({ matched: notes, coverage, seen: baseline(notes), depth: 1 });
    expect(order.map((note) => note.title)).toEqual(['Thinking Fast and Slow 2 Chapter']);
  });
});

describe('freshNotes', () => {
  it('finds only what arrived or changed since the baseline', () => {
    const notes = book(4);
    const seen = { ...baseline(notes.slice(0, 2)), [key(notes[2])]: 'old' };
    expect(freshNotes(notes, seen, {}).map((note) => note.title)).toEqual([
      'Thinking Fast and Slow 3 Chapter',
      'Thinking Fast and Slow 4 Chapter',
    ]);
  });
});

describe('pickSampleNotes', () => {
  it('spreads samples across the book rather than taking its opening', () => {
    const picked = pickSampleNotes(book(9), 3).map((note) => note.title);
    expect(picked).toEqual([
      'Thinking Fast and Slow 2 Chapter',
      'Thinking Fast and Slow 5 Chapter',
      'Thinking Fast and Slow 8 Chapter',
    ]);
  });

  it('takes everything when there is less than asked for', () => {
    expect(pickSampleNotes(book(2), 3)).toHaveLength(2);
    expect(pickSampleNotes(book(2), 0)).toHaveLength(0);
  });
});

describe('planProgress', () => {
  it('counts notes read, complete and given up on', () => {
    const notes = book(4);
    const coverage = {
      ...covered(1, notes[0]),
      ...covered(2, notes[1]),
      [key(notes[2])]: { passes: 0, questionCount: 0, lastAt: 1, failures: MAX_NOTE_FAILURES },
    };
    expect(planProgress(notes, coverage, 2)).toEqual({ total: 4, read: 2, complete: 1, failed: 1 });
  });
});

describe('notesForSize', () => {
  it('asks enough notes to reach the batch at the plan’s density', () => {
    expect(notesForSize(10, 5)).toBe(2);
    expect(notesForSize(10, 4)).toBe(3);
    expect(notesForSize(3, 5)).toBe(1);
    expect(notesForSize(0, 5)).toBe(0);
  });
});
