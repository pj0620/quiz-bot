/**
 * Calendar: the app's second DERIVED material, built on the precedent geography
 * set (see `src/quiz/geography/types.ts` for the full argument).
 *
 * The twelve months, the seven weekdays, the four seasons and a dozen
 * fixed-date holidays are exactly the kind of material derivation was invented
 * for: a small, closed set that is never going to change, where paying a model
 * to write "which month is month 10?" and storing the answer forever would be
 * the wrong shape entirely.
 *
 * So, like geography, a calendar question is never written to the bank. It is
 * derived at session start from the tables in `./data`, and derived AGAIN —
 * identically — whenever a session is resumed. The two properties that make
 * that safe are geography's, unchanged:
 *
 *  - IDENTITY IS STABLE. A question's id is hashed from subject + kind + item,
 *    so "you keep mixing up September and October" stays a durable fact about
 *    a question id.
 *  - CONTENT VARIES BY SEED. Distractor months, distractor holidays and the
 *    month groupings of the ordering questions are drawn from the session
 *    seed, so the same id shows different material between runs.
 *
 * Unlike geography, nothing here needed a new question format or a new view:
 * every calendar question rides an existing format (multiple-choice,
 * short-answer, list-recall, timeline), which is why this folder has no
 * component and no figure — only data and derivation.
 */

/**
 * The four subjects, which are also the topic slugs.
 *
 * One identifier doing both jobs is deliberate, exactly as it is for
 * geography: a quiz rule filtering on the topic `holidays` and the subject
 * that derives holiday questions cannot drift apart.
 */
export const CALENDAR_SUBJECTS = ['months', 'weekdays', 'seasons', 'holidays'] as const;

export type CalendarSubject = (typeof CALENDAR_SUBJECTS)[number];

export function isCalendarSubject(value: unknown): value is CalendarSubject {
  return (
    typeof value === 'string' &&
    (CALENDAR_SUBJECTS as readonly string[]).includes(value)
  );
}

/**
 * The reserved source id every derived question carries.
 *
 * Same precedent as `geography` and `vocab`: real source ids are namespaced
 * (`github-repo:42`), so a bare `calendar` cannot collide, and reusing the
 * field keeps the bank browser's source filter working unchanged.
 */
export const CALENDAR_SOURCE_ID = 'calendar';

/**
 * The topic every calendar question carries, alongside its subject.
 *
 * Fixed rather than model-chosen, so a "Calendar" quiz is buildable through
 * the EXISTING topic picker with no new quiz machinery at all.
 */
export const CALENDAR_TOPIC = 'calendar';

/**
 * What a question asks the reader to do. Part of the question id, so adding a
 * kind creates new questions rather than mutating existing ones.
 */
export const CALENDAR_KINDS = [
  'month-from-number',
  'number-from-month',
  'month-after',
  'month-length',
  'month-order',
  'day-after',
  'day-before',
  'season-of-month',
  'months-of-season',
  'season-after',
  'holiday-date',
  'holiday-month',
  'holiday-from-date',
] as const;

export type CalendarKind = (typeof CALENDAR_KINDS)[number];
