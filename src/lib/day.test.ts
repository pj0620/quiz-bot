// Pinned so the DST assertions below are meaningful regardless of the machine
// running the suite. Must be set before any Date is constructed.
process.env.TZ = 'America/New_York';

import {
  addDays,
  daysBetween,
  formatDayOffset,
  formatInterval,
  isSameDay,
  isWithinDays,
  startOfDay,
} from './day';

/** Local-time constructor, so these read as wall-clock dates. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('startOfDay', () => {
  it('snaps to local midnight', () => {
    const result = new Date(startOfDay(at(2026, 3, 15, 23, 59)));
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(15);
  });

  it('is idempotent', () => {
    const once = startOfDay(at(2026, 3, 15, 8));
    expect(startOfDay(once)).toBe(once);
  });
});

describe('daysBetween', () => {
  it('counts calendar days, not 24-hour windows', () => {
    // 23:00 yesterday to 01:00 today is two hours, but one calendar day.
    expect(daysBetween(at(2026, 5, 10, 23), at(2026, 5, 11, 1))).toBe(1);
  });

  it('is zero within a day and signed across days', () => {
    expect(daysBetween(at(2026, 5, 10, 1), at(2026, 5, 10, 23))).toBe(0);
    expect(daysBetween(at(2026, 5, 10), at(2026, 5, 13))).toBe(3);
    expect(daysBetween(at(2026, 5, 13), at(2026, 5, 10))).toBe(-3);
  });

  /**
   * The reason this module exists. US DST springs forward 2026-03-08, making
   * that day 23 hours long — raw `(b - a) / 86400000` would yield 0.958 and
   * truncate to 0 days.
   */
  it('is correct across a spring-forward boundary', () => {
    expect(daysBetween(at(2026, 3, 7, 12), at(2026, 3, 8, 12))).toBe(1);
    expect(daysBetween(at(2026, 3, 7, 12), at(2026, 3, 10, 12))).toBe(3);
  });

  it('is correct across a fall-back boundary', () => {
    // 2026-11-01 is 25 hours long.
    expect(daysBetween(at(2026, 10, 31, 12), at(2026, 11, 1, 12))).toBe(1);
    expect(daysBetween(at(2026, 10, 30, 12), at(2026, 11, 3, 12))).toBe(4);
  });

  it('crosses month and year boundaries', () => {
    expect(daysBetween(at(2026, 1, 31), at(2026, 2, 1))).toBe(1);
    expect(daysBetween(at(2025, 12, 31), at(2026, 1, 1))).toBe(1);
  });
});

describe('addDays', () => {
  it('rolls over months and years', () => {
    expect(isSameDay(addDays(at(2026, 1, 31), 1), at(2026, 2, 1))).toBe(true);
    expect(isSameDay(addDays(at(2025, 12, 31), 1), at(2026, 1, 1))).toBe(true);
  });

  it('survives a DST boundary without drifting an hour', () => {
    const result = new Date(addDays(at(2026, 3, 7, 12), 1));
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(12); // would be 11 or 13 with raw ms math
  });

  it('accepts negative offsets', () => {
    expect(isSameDay(addDays(at(2026, 5, 10), -3), at(2026, 5, 7))).toBe(true);
  });

  it('round-trips with daysBetween', () => {
    const start = at(2026, 6, 1);
    for (const days of [1, 7, 30, 180]) {
      expect(daysBetween(start, addDays(start, days))).toBe(days);
    }
  });
});

describe('isWithinDays', () => {
  const now = at(2026, 5, 10, 12);

  it('includes today', () => {
    expect(isWithinDays(at(2026, 5, 10, 0, 1), 1, now)).toBe(true);
  });

  /** The boundary that decides whether "last 7 days" quizzes feel right. */
  it('treats N days as N calendar days inclusive of today', () => {
    expect(isWithinDays(at(2026, 5, 10), 2, now)).toBe(true); // today
    expect(isWithinDays(at(2026, 5, 9, 23, 59), 2, now)).toBe(true); // yesterday, late
    expect(isWithinDays(at(2026, 5, 9, 0, 1), 2, now)).toBe(true); // yesterday, early
    expect(isWithinDays(at(2026, 5, 8, 23, 59), 2, now)).toBe(false); // two days back
  });

  it('excludes the future and rejects non-positive windows', () => {
    expect(isWithinDays(at(2026, 5, 11), 7, now)).toBe(false);
    expect(isWithinDays(at(2026, 5, 10), 0, now)).toBe(false);
    expect(isWithinDays(at(2026, 5, 10), -1, now)).toBe(false);
  });
});

describe('formatDayOffset', () => {
  const now = at(2026, 5, 10, 12);

  it('names near days', () => {
    expect(formatDayOffset(at(2026, 5, 10, 18), now)).toBe('today');
    expect(formatDayOffset(at(2026, 5, 11), now)).toBe('tomorrow');
    expect(formatDayOffset(at(2026, 5, 9), now)).toBe('yesterday');
  });

  it('pluralizes distant days in both directions', () => {
    expect(formatDayOffset(at(2026, 5, 16), now)).toBe('in 6 days');
    expect(formatDayOffset(at(2026, 5, 4), now)).toBe('6 days ago');
  });
});

describe('formatInterval', () => {
  it('scales units', () => {
    expect(formatInterval(0.5)).toBe('<1d');
    expect(formatInterval(1)).toBe('1d');
    expect(formatInterval(6)).toBe('6d');
    expect(formatInterval(21)).toBe('3w');
    expect(formatInterval(90)).toBe('3mo');
  });
});
