import { hashString, seededShuffle } from '../../lib/random';
import type { Choice, Difficulty, Question, TimelineEvent } from '../types';
import {
  HOLIDAYS,
  MONTHS,
  NUMBER_WORDS,
  ORDINAL_WORDS,
  SEASONS,
  WEEKDAYS,
  monthById,
  monthsOfSeason,
  nextMonth,
  nextSeason,
  nextWeekday,
  ordinal,
  previousWeekday,
  seasonById,
  type Month,
} from './data';
import {
  CALENDAR_SOURCE_ID,
  CALENDAR_SUBJECTS,
  CALENDAR_TOPIC,
  type CalendarKind,
  type CalendarSubject,
} from './types';

/**
 * Derives calendar questions from the tables in `./data`.
 *
 * Structured exactly like `geography/catalog.ts`, and governed by the same
 * one rule:
 *
 *   The QUESTION ID may depend only on subject, kind and item.
 *   Everything else may depend on the seed.
 *
 * Break the first half and every stored review state is orphaned silently.
 * Break the second half and the same distractors come up every single time.
 */

/** How many options a multiple-choice question offers. */
const CHOICE_COUNT = 4;

/**
 * Months, weekdays and seasons are primary-school material; holiday dates are
 * not — knowing Veterans Day is November 11 is genuinely harder than knowing
 * October is month ten, and difficulty feeds quiz rules.
 */
const SUBJECT_DIFFICULTY: Record<CalendarSubject, Difficulty> = {
  months: 'intro',
  weekdays: 'intro',
  seasons: 'intro',
  holidays: 'core',
};

/**
 * A question's permanent identity. Deliberately NOT hashed with anything
 * seed-derived — see `geographyQuestionId`, which this mirrors.
 */
export function calendarQuestionId(
  subject: CalendarSubject,
  kind: CalendarKind,
  itemId: string,
): string {
  return `cal-${hashString(`calendar:${subject}:${kind}:${itemId}`).toString(36)}`;
}

/** Everything a derived question shares. Kept in one place so ids and topics can't drift. */
function base(input: {
  subject: CalendarSubject;
  kind: CalendarKind;
  itemId: string;
  prompt: string;
  explanation: string;
  now: number;
}) {
  const { subject, kind, itemId, prompt, explanation, now } = input;
  return {
    id: calendarQuestionId(subject, kind, itemId),
    prompt,
    explanation,
    // Two topics, both fixed, never model-chosen: the general one builds a
    // Calendar quiz, the specific one builds a Holidays quiz.
    topics: [CALENDAR_TOPIC, subject],
    difficulty: SUBJECT_DIFFICULTY[subject],
    sourceId: CALENDAR_SOURCE_ID,
    // Namespaces the item the way geography namespaces a region. There is no
    // file behind it and no revision to record.
    provenance: { sourceId: CALENDAR_SOURCE_ID, path: `${subject}/${itemId}` },
    addedAt: now,
  };
}

/** Per-question seed, so reordering a loop cannot shift an unrelated question's options. */
function seedFor(subject: CalendarSubject, kind: CalendarKind, itemId: string, seed: number): number {
  return hashString(`${subject}:${kind}:${itemId}:choice`) ^ seed;
}

/**
 * A seeded sample of wrong answers.
 *
 * Unlike geography there is no "neighbour" preference here: a wrong month
 * doesn't resemble the right one the way New Hampshire resembles Vermont, so
 * any wrong month is as useful as any other and a plain seeded draw is the
 * whole job.
 */
function distractors<T extends { id: string }>(
  pool: readonly T[],
  exclude: readonly string[],
  seed: number,
): T[] {
  const excluded = new Set(exclude);
  const candidates = pool.filter((entry) => !excluded.has(entry.id));
  return seededShuffle(candidates, seed).slice(0, CHOICE_COUNT - 1);
}

/**
 * Correct answer FIRST, never shuffled here: `MultipleChoiceView` shuffles at
 * render from the question id and the session seed, so emitting the answer
 * first does not leak it.
 */
function choicesOf(correct: { id: string; name: string }, wrong: readonly { id: string; name: string }[]): Choice[] {
  return [correct, ...wrong].map((entry) => ({ id: entry.id, text: entry.name }));
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

/** How many ordering questions `months` derives. Part of their ids via `order-N`. */
const MONTH_ORDER_QUESTIONS = 3;
const MONTHS_PER_ORDER_QUESTION = 4;

function monthQuestions(seed: number, now: number): Question[] {
  const questions: Question[] = [];

  for (const month of MONTHS) {
    questions.push({
      ...base({
        subject: 'months',
        kind: 'month-from-number',
        itemId: month.id,
        prompt: `Which month is month number ${month.number} of the year?`,
        explanation: `${month.name} is month ${month.number}.`,
        now,
      }),
      format: 'short-answer',
      modelAnswer: month.name,
      // Abbreviations ride `acceptable` the way geography aliases do: "Oct"
      // is a right answer, and a miss falls through to self-grading rather
      // than being marked wrong.
      acceptable: [month.name, ...month.abbrevs],
    });

    questions.push({
      ...base({
        subject: 'months',
        kind: 'number-from-month',
        itemId: month.id,
        prompt: `${month.name} is which month number of the year (1–12)?`,
        explanation: `${month.name} is month ${month.number}.`,
        now,
      }),
      format: 'short-answer',
      modelAnswer: String(month.number),
      acceptable: [
        String(month.number),
        ordinal(month.number),
        NUMBER_WORDS[month.number],
        ORDINAL_WORDS[month.number],
      ],
    });

    const after = nextMonth(month);
    questions.push({
      ...base({
        subject: 'months',
        kind: 'month-after',
        itemId: month.id,
        prompt: `Which month comes right after ${month.name}?`,
        explanation:
          month.id === 'dec'
            ? 'After December the year wraps around to January.'
            : `${after.name} follows ${month.name}.`,
        now,
      }),
      format: 'multiple-choice',
      choices: choicesOf(
        after,
        // The asked month is excluded as well as the answer: offering
        // "April" as an option under "what follows April?" reads as a typo,
        // not a distractor.
        distractors(MONTHS, [after.id, month.id], seedFor('months', 'month-after', month.id, seed)),
      ),
      correctChoiceId: after.id,
    });

    questions.push({
      ...base({
        subject: 'months',
        kind: 'month-length',
        itemId: month.id,
        prompt: `How many days does ${month.name} have?`,
        explanation:
          month.id === 'feb'
            ? 'February has 28 days — 29 in a leap year.'
            : `${month.name} has ${month.days} days.`,
        now,
      }),
      format: 'multiple-choice',
      /*
        The three real month lengths, fixed rather than seeded: "how long is
        September" has exactly two plausible wrong answers, and padding the
        options with 27 or 32 would hand the answer to anyone who knows no
        month is that long.
      */
      choices: [
        { id: `d${month.days}`, text: month.id === 'feb' ? '28 (29 in a leap year)' : String(month.days) },
        ...[28, 30, 31]
          .filter((days) => days !== month.days)
          .map((days) => ({ id: `d${days}`, text: days === 28 ? '28 (29 in a leap year)' : String(days) })),
      ],
      correctChoiceId: `d${month.days}`,
    });
  }

  /*
    The ordering questions. Ids are fixed slots (`order-1`..`order-3`) while
    the months each slot holds are drawn from the seed — the same split
    multiple-choice makes between identity and presentation, stretched a
    little further: here the whole event set is presentation, because the fact
    under test ("you know the year's order") is the same whichever months come
    up. One seeded shuffle sliced three ways guarantees the three questions in
    a session never share a month.
  */
  const shuffled = seededShuffle(MONTHS, hashString('months:order') ^ seed);
  for (let slot = 0; slot < MONTH_ORDER_QUESTIONS; slot += 1) {
    const group = shuffled
      .slice(slot * MONTHS_PER_ORDER_QUESTION, (slot + 1) * MONTHS_PER_ORDER_QUESTION)
      .sort((a, b) => a.number - b.number);

    const events: TimelineEvent[] = group.map((month) => ({
      id: month.id,
      label: month.name,
      // Revealed only after answering, like every timeline date.
      date: `Month ${month.number}`,
    }));

    questions.push({
      ...base({
        subject: 'months',
        kind: 'month-order',
        itemId: `order-${slot + 1}`,
        prompt: 'Put these months in the order they fall in the year.',
        explanation: `In calendar order: ${group.map((month) => month.name).join(', ')}.`,
        now,
      }),
      format: 'timeline',
      events,
    });
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Weekdays
// ---------------------------------------------------------------------------

function weekdayQuestions(seed: number, now: number): Question[] {
  const questions: Question[] = [];

  /*
    Only cyclic questions — see the WEEKDAYS table for why. "What comes after
    Saturday?" has one answer everywhere; "put these days in order" and "what
    number day is Sunday?" depend on which day starts the week, and a question
    two calendars grade differently is not asked.
  */
  for (const day of WEEKDAYS) {
    const after = nextWeekday(day);
    questions.push({
      ...base({
        subject: 'weekdays',
        kind: 'day-after',
        itemId: day.id,
        prompt: `Which day comes right after ${day.name}?`,
        explanation: `${after.name} follows ${day.name}.`,
        now,
      }),
      format: 'multiple-choice',
      choices: choicesOf(
        after,
        distractors(WEEKDAYS, [after.id, day.id], seedFor('weekdays', 'day-after', day.id, seed)),
      ),
      correctChoiceId: after.id,
    });

    const before = previousWeekday(day);
    questions.push({
      ...base({
        subject: 'weekdays',
        kind: 'day-before',
        itemId: day.id,
        prompt: `Which day comes right before ${day.name}?`,
        explanation: `${before.name} comes before ${day.name}.`,
        now,
      }),
      format: 'multiple-choice',
      choices: choicesOf(
        before,
        distractors(WEEKDAYS, [before.id, day.id], seedFor('weekdays', 'day-before', day.id, seed)),
      ),
      correctChoiceId: before.id,
    });
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/** "March, April and May" — the phrasing every season explanation uses. */
function listNames(months: readonly Month[]): string {
  const names = months.map((month) => month.name);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function seasonQuestions(now: number): Question[] {
  const questions: Question[] = [];

  for (const season of SEASONS) {
    const members = monthsOfSeason(season.id);

    questions.push({
      ...base({
        subject: 'seasons',
        kind: 'months-of-season',
        itemId: season.id,
        prompt: `Which three months make up ${season.name.toLowerCase()} in the Northern Hemisphere?`,
        explanation: `${season.name} is ${listNames(members)}.`,
        now,
      }),
      format: 'list-recall',
      required: members.length,
      items: members.map((month) => month.name),
    });

    const after = nextSeason(season);
    questions.push({
      ...base({
        subject: 'seasons',
        kind: 'season-after',
        itemId: season.id,
        prompt: `Which season comes after ${season.name.toLowerCase()}?`,
        explanation: `${after.name} follows ${season.name.toLowerCase()}.`,
        now,
      }),
      format: 'multiple-choice',
      // The three other seasons: with four in the world there is nothing to
      // sample, so these options are fixed and only their render order varies.
      choices: choicesOf(after, SEASONS.filter((entry) => entry.id !== after.id && entry.id !== season.id)),
      correctChoiceId: after.id,
    });
  }

  for (const month of MONTHS) {
    const season = seasonById(month.season);
    questions.push({
      ...base({
        subject: 'seasons',
        kind: 'season-of-month',
        itemId: month.id,
        prompt: `Which season is ${month.name} in, in the Northern Hemisphere?`,
        explanation: `${month.name} is a ${season.name.toLowerCase()} month in the Northern Hemisphere.`,
        now,
      }),
      format: 'multiple-choice',
      choices: choicesOf(season, SEASONS.filter((entry) => entry.id !== season.id)),
      correctChoiceId: season.id,
    });
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

/**
 * Every date spelling a reader might type: "December 25", "Dec 25th",
 * "12/25", "25 December". Missing one is not a wrong mark — short-answer
 * falls through to self-grading on a miss — but each spelling here is one
 * self-grade the reader is spared.
 */
function dateSpellings(month: Month, day: number): string[] {
  const names = [month.name, ...month.abbrevs];
  return [
    ...names.flatMap((name) => [`${name} ${day}`, `${name} ${ordinal(day)}`]),
    `${month.number}/${day}`,
    `${day} ${month.name}`,
  ];
}

function holidayQuestions(seed: number, now: number): Question[] {
  const questions: Question[] = [];

  for (const holiday of HOLIDAYS) {
    const month = monthById(holiday.monthId);
    const date = `${month.name} ${holiday.day}`;

    questions.push({
      ...base({
        subject: 'holidays',
        kind: 'holiday-date',
        itemId: holiday.id,
        prompt: `On what date is ${holiday.name}?`,
        explanation: `${holiday.name} is on ${date}.`,
        now,
      }),
      format: 'short-answer',
      modelAnswer: date,
      acceptable: dateSpellings(month, holiday.day),
    });

    questions.push({
      ...base({
        subject: 'holidays',
        kind: 'holiday-month',
        itemId: holiday.id,
        prompt: `Which month is ${holiday.name} in?`,
        explanation: `${holiday.name} falls on ${date}.`,
        now,
      }),
      format: 'multiple-choice',
      choices: choicesOf(
        month,
        distractors(MONTHS, [month.id], seedFor('holidays', 'holiday-month', holiday.id, seed)),
      ),
      correctChoiceId: month.id,
    });

    questions.push({
      ...base({
        subject: 'holidays',
        kind: 'holiday-from-date',
        itemId: holiday.id,
        prompt: `Which holiday falls on ${date}?`,
        explanation: `${date} is ${holiday.name}.`,
        now,
      }),
      format: 'multiple-choice',
      choices: choicesOf(
        holiday,
        distractors(HOLIDAYS, [holiday.id], seedFor('holidays', 'holiday-from-date', holiday.id, seed)),
      ),
      correctChoiceId: holiday.id,
    });
  }

  return questions;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

function questionsForSubject(subject: CalendarSubject, seed: number, now: number): Question[] {
  switch (subject) {
    case 'months':
      return monthQuestions(seed, now);
    case 'weekdays':
      return weekdayQuestions(seed, now);
    case 'seasons':
      return seasonQuestions(now);
    case 'holidays':
      return holidayQuestions(seed, now);
  }
}

/**
 * The derived bank for the enabled subjects.
 *
 * `seed` should be the session's own seed, which is persisted — that is what
 * makes a resumed session regenerate the same options it was showing before.
 */
export function listCalendarQuestions(
  subjects: readonly CalendarSubject[],
  seed: number,
  now = Date.now(),
): Question[] {
  const questions: Question[] = [];
  for (const subject of subjects) {
    questions.push(...questionsForSubject(subject, seed, now));
  }
  return questions;
}

/** Whether a question came from here. Cheap enough to call per row. */
export function isCalendarQuestion(question: Question): boolean {
  return question.sourceId === CALENDAR_SOURCE_ID;
}

/** What the Settings card lists: one row per subject, with a live count. */
export function describeCalendarSubjects(): { id: CalendarSubject; label: string; count: number }[] {
  const labels: Record<CalendarSubject, string> = {
    months: 'Months of the year',
    weekdays: 'Days of the week',
    seasons: 'Seasons',
    holidays: 'Holiday dates',
  };
  return CALENDAR_SUBJECTS.map((subject) => ({
    id: subject,
    label: labels[subject],
    // Counts are seed-independent — any seed derives the same set of ids —
    // so a fixed seed here can never disagree with a real session.
    count: questionsForSubject(subject, 0, 0).length,
  }));
}
