import { createStore } from '../../lib/createStore';
import { readJsonSync, writeJson } from '../../lib/kv';
import { CALENDAR_SUBJECTS, isCalendarSubject, type CalendarSubject } from './types';

/**
 * Which calendar subjects are switched on.
 *
 * A carbon copy of `geography/preferences.ts`, kept separate rather than
 * generalised because the two stores must be able to migrate independently —
 * a versioned key shared across features couples their schemas forever.
 *
 * EMPTY BY DEFAULT, and that is the important part: the catalog is ~120
 * questions nobody asked for, and unioning it into selection unconditionally
 * would change what every existing quiz draws on the first launch after the
 * update — the Daily quiz especially, since derived questions are always
 * within its `addedWithinDays` window. Opting in is a deliberate act.
 */

const PREFERENCES_KEY = 'quizbot.calendar.prefs.v1';

export type CalendarPreferences = {
  subjects: CalendarSubject[];
};

const DEFAULTS: CalendarPreferences = { subjects: [] };

/** Tolerates a stale or partly-unknown stored value rather than discarding all of it. */
function loadSync(): CalendarPreferences {
  const stored = readJsonSync<Partial<CalendarPreferences>>(PREFERENCES_KEY);
  if (!stored || !Array.isArray(stored.subjects)) return DEFAULTS;

  // Filtered rather than trusted, and de-duplicated by rebuilding from the
  // canonical list — the same two repairs geography makes, for the same
  // reasons.
  const subjects = stored.subjects.filter(isCalendarSubject);
  return { subjects: CALENDAR_SUBJECTS.filter((subject) => subjects.includes(subject)) };
}

export const calendarStore = createStore<CalendarPreferences>(loadSync());

function persist(next: CalendarPreferences): void {
  calendarStore.set(next);
  // Fire-and-forget: a failed preference write must not break the screen.
  void writeJson(PREFERENCES_KEY, next).catch(() => undefined);
}

export function setCalendarSubjectEnabled(subject: CalendarSubject, enabled: boolean): void {
  const current = calendarStore.get().subjects;
  if (enabled === current.includes(subject)) return;

  const subjects = enabled
    ? CALENDAR_SUBJECTS.filter((entry) => entry === subject || current.includes(entry))
    : current.filter((entry) => entry !== subject);

  persist({ subjects });
}

export function getEnabledCalendarSubjects(): CalendarSubject[] {
  return calendarStore.get().subjects;
}

export function isCalendarSubjectEnabled(subject: CalendarSubject): boolean {
  return calendarStore.get().subjects.includes(subject);
}

/** React binding, kept beside the mutation API for a store this small. */
export function useEnabledCalendarSubjects(): CalendarSubject[] {
  return calendarStore.useSelector((state) => state.subjects);
}
