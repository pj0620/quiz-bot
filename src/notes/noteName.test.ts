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

  it('recognises a chapter marker as the index', () => {
    /*
      The real-vault case. "Thinking Fast And Slow Ch.1" is entirely series plus
      position, and failing to split it loses the one piece of context that
      makes terse notes readable — that they are notes on that book.
    */
    expect(parseNoteName('Thinking Fast And Slow Ch.1')).toEqual({
      series: 'Thinking Fast And Slow',
      index: 1,
      title: 'Thinking Fast And Slow Ch.1',
    });
  });

  it('accepts the other ways a position gets written', () => {
    expect(parseNoteName('Thinking Fast And Slow Ch1').series).toBe('Thinking Fast And Slow');
    expect(parseNoteName('Some Long Series Pt.2').index).toBe(2);
    expect(parseNoteName('Some Long Series #3').index).toBe(3);
    expect(parseNoteName('Some Long Series No.4').index).toBe(4);
  });

  it('splits when nothing follows the number, if the series is substantial', () => {
    expect(parseNoteName('History of America 40')).toEqual({
      series: 'History of America',
      index: 40,
      title: 'History of America 40',
    });
  });

  it('still refuses when a trailing number would leave a one-word series', () => {
    // "Chapter" alone would match every numbered note in the vault.
    expect(parseNoteName('Chapter 5')).toEqual({ title: 'Chapter 5' });
    expect(parseNoteName('Ch.1')).toEqual({ title: 'Ch.1' });
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
