/**
 * Local-calendar-day helpers.
 *
 * Scheduling and "added in the last N days" are calendar-day concepts, not
 * 24-hour-window concepts: something added at 23:00 yesterday is "1 day ago"
 * even though it was only an hour ago. Doing this with raw millisecond
 * arithmetic gets DST wrong twice a year, so everything routes through here.
 */

export const MS_PER_DAY = 86_400_000;

/** Midnight at the start of the local day containing `ms`. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Midnight at the start of the day `days` after the local day of `ms`. */
export function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  // setDate handles month/year rollover and DST shifts correctly; adding
  // days * MS_PER_DAY does not.
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/**
 * Whole calendar days from `from` to `to`. Positive when `to` is later.
 * Rounded because a DST boundary makes one of these days 23 or 25 hours long.
 */
export function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

/** True when `ms` falls within the last `days` calendar days, today included. */
export function isWithinDays(ms: number, days: number, now: number): boolean {
  if (days <= 0) return false;
  const age = daysBetween(ms, now);
  // age === 0 is today; days - 1 back is the inclusive lower bound.
  return age >= 0 && age <= days - 1;
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** "in 3 days" / "today" / "3 days ago" — for due dates. */
export function formatDayOffset(target: number, now: number): string {
  const days = daysBetween(now, target);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/** Compact interval label for review state: "6d", "3w", "4mo". */
export function formatInterval(days: number): string {
  if (days < 1) return '<1d';
  if (days < 14) return `${Math.round(days)}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}
