import { parseNoteName } from './noteName';

describe('parseNoteName', () => {
  it('splits series, index and title', () => {
    expect(parseNoteName('History of America 40 First Year of Fighting')).toEqual({
      series: 'History of America',
      index: 40,
      title: 'First Year of Fighting',
    });
  });

  it('collapses a numbered run onto one series', () => {
    const names = [
      'History of America 17 The Federalists',
      'History of America 18 The Jeffersonians',
      'History of America 40 First Year of Fighting',
    ].map(parseNoteName);

    // The whole point: forty notes, one topic.
    expect(new Set(names.map((name) => name.series)).size).toBe(1);
  });

  it('keeps a year inside the title rather than treating it as an index', () => {
    expect(parseNoteName('Britain in 1970 A Retrospective')).toEqual({
      title: 'Britain in 1970 A Retrospective',
    });
  });

  it('does not treat a trailing-letter number as an index', () => {
    expect(parseNoteName('Britain in the 70s')).toEqual({ title: 'Britain in the 70s' });
  });

  it('refuses to split when nothing follows the number', () => {
    // "Chapter" alone would be a useless topic, so no series is better.
    expect(parseNoteName('Chapter 5')).toEqual({ title: 'Chapter 5' });
    expect(parseNoteName('History of America 40')).toEqual({ title: 'History of America 40' });
  });

  it('refuses to split when nothing precedes the number', () => {
    expect(parseNoteName('01 Introduction')).toEqual({ title: '01 Introduction' });
  });

  it('ignores separator tokens around the index', () => {
    expect(parseNoteName('Thinking Fast and Slow - 11 - Anchoring')).toEqual({
      series: 'Thinking Fast and Slow',
      index: 11,
      title: 'Anchoring',
    });
  });

  it('normalizes runs of whitespace', () => {
    expect(parseNoteName('  History  of America   40   First Year ')).toEqual({
      series: 'History of America',
      index: 40,
      title: 'First Year',
    });
  });

  it('reads " - " as hierarchy when there is no number', () => {
    // Without this the whole string becomes one topic slug, long enough to be
    // truncated mid-word into "podcast-netherlands-the-revolt-t".
    expect(parseNoteName('Podcast - Netherlands - The Revolt That Made the modern world')).toEqual({
      series: 'Podcast Netherlands',
      title: 'The Revolt That Made the modern world',
    });
  });

  it('prefers a numeric index over a separator', () => {
    expect(parseNoteName('Thinking Fast and Slow - 11 - Anchoring').series).toBe(
      'Thinking Fast and Slow',
    );
  });

  it('does not split a hyphenated word', () => {
    expect(parseNoteName('The Austro-Hungarian Compromise')).toEqual({
      title: 'The Austro-Hungarian Compromise',
    });
  });

  it('handles a zero-padded index', () => {
    expect(parseNoteName('Biology 07 Pipelines')).toEqual({
      series: 'Biology',
      index: 7,
      title: 'Pipelines',
    });
  });
});
