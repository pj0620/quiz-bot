import { createStore } from '../../lib/createStore';
import { readJsonSync, writeJson } from '../../lib/kv';
import { GEOGRAPHY_SUBJECTS, isGeographySubject, type GeographySubject } from './types';

/**
 * Which geography subjects are switched on.
 *
 * Modelled on `src/quiz/preferences.ts` rather than the envelope helpers: a
 * small settings object read whole, where a partial or stale stored value is
 * better repaired field by field than discarded.
 *
 * EMPTY BY DEFAULT, and that is the important part. The catalog is ~300
 * questions that no reader asked for, and unioning it into selection
 * unconditionally would change what every existing quiz draws on the first
 * launch after the update — the Daily quiz especially, since derived questions
 * are always within its `addedWithinDays` window. Opting in is a deliberate act.
 */

const PREFERENCES_KEY = 'quizbot.geography.prefs.v1';

export type GeographyPreferences = {
  subjects: GeographySubject[];
};

const DEFAULTS: GeographyPreferences = { subjects: [] };

/** Tolerates a stale or partly-unknown stored value rather than discarding all of it. */
function loadSync(): GeographyPreferences {
  const stored = readJsonSync<Partial<GeographyPreferences>>(PREFERENCES_KEY);
  if (!stored || !Array.isArray(stored.subjects)) return DEFAULTS;

  // Filtered rather than trusted: a subject removed in a later version would
  // otherwise reach `listGeographyQuestions` and index a map that is gone.
  const subjects = stored.subjects.filter(isGeographySubject);
  // De-duplicated because a repeated subject would derive its questions twice,
  // and two rows with one id is a bank the selection engine cannot reason about.
  return { subjects: GEOGRAPHY_SUBJECTS.filter((subject) => subjects.includes(subject)) };
}

export const geographyStore = createStore<GeographyPreferences>(loadSync());

function persist(next: GeographyPreferences): void {
  geographyStore.set(next);
  // Fire-and-forget: a failed preference write must not break the screen.
  void writeJson(PREFERENCES_KEY, next).catch(() => undefined);
}

export function setSubjectEnabled(subject: GeographySubject, enabled: boolean): void {
  const current = geographyStore.get().subjects;
  if (enabled === current.includes(subject)) return;

  const subjects = enabled
    ? GEOGRAPHY_SUBJECTS.filter((entry) => entry === subject || current.includes(entry))
    : current.filter((entry) => entry !== subject);

  persist({ subjects });
}

export function getEnabledSubjects(): GeographySubject[] {
  return geographyStore.get().subjects;
}

export function isSubjectEnabled(subject: GeographySubject): boolean {
  return geographyStore.get().subjects.includes(subject);
}

/** React binding, kept beside the mutation API for a store this small. */
export function useEnabledSubjects(): GeographySubject[] {
  return geographyStore.useSelector((state) => state.subjects);
}
