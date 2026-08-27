/**
 * The calendar tables every question is derived from.
 *
 * Hand-written rather than built by a script, because unlike the geography
 * boundaries there is nothing to project or simplify — the whole domain is a
 * few dozen rows a person can read and check.
 *
 * IDS ARE PERMANENT. They feed `calendarQuestionId`, so renaming `oct` or
 * `halloween` orphans every review state those questions have accumulated.
 * Names, aliases, distractor preferences — anything else — may change freely.
 */

export type SeasonId = 'spring' | 'summer' | 'fall' | 'winter';

export type Month = {
  /** Permanent — part of question ids. */
  id: string;
  name: string;
  /** 1..12, January first. */
  number: number;
  /**
   * Other ways a reader might reasonably type the month. Feeds `acceptable`
   * on short-answer questions, so "Oct" and "Sept" pass without any new
   * grading code — the same job `Region.aliases` does for "Czechia".
   */
  abbrevs: string[];
  /** Days in a common (non-leap) year. February is 28 here; the leap-year
   * caveat lives in the question text, not the table. */
  days: number;
  /**
   * Northern-Hemisphere meteorological season — whole months, the way the
   * seasons are taught: spring is March–May, summer June–August, and so on.
   * The astronomical solstice/equinox split would put single months in two
   * seasons, which is unquizzable. Every prompt that uses this says
   * "Northern Hemisphere" so the question stays well-defined.
   */
  season: SeasonId;
};

export const MONTHS: readonly Month[] = [
  { id: 'jan', name: 'January', number: 1, abbrevs: ['Jan'], days: 31, season: 'winter' },
  { id: 'feb', name: 'February', number: 2, abbrevs: ['Feb'], days: 28, season: 'winter' },
  { id: 'mar', name: 'March', number: 3, abbrevs: ['Mar'], days: 31, season: 'spring' },
  { id: 'apr', name: 'April', number: 4, abbrevs: ['Apr'], days: 30, season: 'spring' },
  { id: 'may', name: 'May', number: 5, abbrevs: [], days: 31, season: 'spring' },
  { id: 'jun', name: 'June', number: 6, abbrevs: ['Jun'], days: 30, season: 'summer' },
  { id: 'jul', name: 'July', number: 7, abbrevs: ['Jul'], days: 31, season: 'summer' },
  { id: 'aug', name: 'August', number: 8, abbrevs: ['Aug'], days: 31, season: 'summer' },
  { id: 'sep', name: 'September', number: 9, abbrevs: ['Sep', 'Sept'], days: 30, season: 'fall' },
  { id: 'oct', name: 'October', number: 10, abbrevs: ['Oct'], days: 31, season: 'fall' },
  { id: 'nov', name: 'November', number: 11, abbrevs: ['Nov'], days: 30, season: 'fall' },
  { id: 'dec', name: 'December', number: 12, abbrevs: ['Dec'], days: 31, season: 'winter' },
];

export type Weekday = {
  /** Permanent — part of question ids. */
  id: string;
  name: string;
};

/**
 * Stored Monday-first, but NOTHING may depend on where the array starts: which
 * day begins the week is a convention that differs between the US and ISO, so
 * the only order questions asked about weekdays are cyclic ("what comes after
 * Saturday?"), which every convention answers the same way. This is also why
 * weekdays get no "day number" question — Sunday is day 1 or day 7 depending
 * on who you ask, and a question two calendars grade differently is not a
 * knowledge question.
 */
export const WEEKDAYS: readonly Weekday[] = [
  { id: 'mon', name: 'Monday' },
  { id: 'tue', name: 'Tuesday' },
  { id: 'wed', name: 'Wednesday' },
  { id: 'thu', name: 'Thursday' },
  { id: 'fri', name: 'Friday' },
  { id: 'sat', name: 'Saturday' },
  { id: 'sun', name: 'Sunday' },
];

export type Season = {
  /** Permanent — part of question ids. */
  id: SeasonId;
  name: string;
};

/** In year order starting from spring; `nextSeason` wraps. */
export const SEASONS: readonly Season[] = [
  { id: 'spring', name: 'Spring' },
  { id: 'summer', name: 'Summer' },
  { id: 'fall', name: 'Fall' },
  { id: 'winter', name: 'Winter' },
];

export type Holiday = {
  /** Permanent — part of question ids. */
  id: string;
  name: string;
  /** A `Month.id`. */
  monthId: string;
  day: number;
  /** Other names a reader might type for the holiday itself. */
  aliases?: string[];
};

/**
 * FIXED-DATE holidays only, on purpose. Thanksgiving, Easter and Mother's Day
 * move every year, so "what date is Thanksgiving?" has no answer a short-answer
 * grader could hold — the moment a holiday needs a rule instead of a date, it
 * doesn't belong in this table.
 */
export const HOLIDAYS: readonly Holiday[] = [
  { id: 'new-years-day', name: "New Year's Day", monthId: 'jan', day: 1 },
  { id: 'groundhog-day', name: 'Groundhog Day', monthId: 'feb', day: 2 },
  { id: 'valentines', name: "Valentine's Day", monthId: 'feb', day: 14 },
  { id: 'st-patricks', name: "St. Patrick's Day", monthId: 'mar', day: 17, aliases: ["Saint Patrick's Day"] },
  { id: 'april-fools', name: "April Fools' Day", monthId: 'apr', day: 1 },
  { id: 'cinco-de-mayo', name: 'Cinco de Mayo', monthId: 'may', day: 5 },
  { id: 'juneteenth', name: 'Juneteenth', monthId: 'jun', day: 19 },
  { id: 'independence-day', name: 'Independence Day (US)', monthId: 'jul', day: 4, aliases: ['Fourth of July', '4th of July', 'July 4th'] },
  { id: 'halloween', name: 'Halloween', monthId: 'oct', day: 31 },
  { id: 'veterans-day', name: 'Veterans Day', monthId: 'nov', day: 11 },
  { id: 'christmas', name: 'Christmas', monthId: 'dec', day: 25, aliases: ['Christmas Day'] },
  { id: 'new-years-eve', name: "New Year's Eve", monthId: 'dec', day: 31 },
];

/** `1 → "1st"`, `22 → "22nd"` — for the date spellings a reader might type. */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

/**
 * "ten" / "tenth" — the words behind "October is month ten". Indexed 1..12;
 * feeds `acceptable`, so a reader who writes the word is not marked down for
 * not writing the digit.
 */
export const NUMBER_WORDS: readonly string[] = [
  '', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

export const ORDINAL_WORDS: readonly string[] = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
];

export function monthById(id: string): Month {
  const month = MONTHS.find((entry) => entry.id === id);
  if (!month) throw new Error(`unknown month id: ${id}`);
  return month;
}

/** Cyclic: after December comes January. */
export function nextMonth(month: Month): Month {
  return MONTHS[month.number % 12];
}

/** Cyclic: after Sunday comes Monday, whatever day the week "starts". */
export function nextWeekday(day: Weekday): Weekday {
  const index = WEEKDAYS.findIndex((entry) => entry.id === day.id);
  return WEEKDAYS[(index + 1) % WEEKDAYS.length];
}

export function previousWeekday(day: Weekday): Weekday {
  const index = WEEKDAYS.findIndex((entry) => entry.id === day.id);
  return WEEKDAYS[(index + WEEKDAYS.length - 1) % WEEKDAYS.length];
}

/** Cyclic: after winter comes spring again. */
export function nextSeason(season: Season): Season {
  const index = SEASONS.findIndex((entry) => entry.id === season.id);
  return SEASONS[(index + 1) % SEASONS.length];
}

export function seasonById(id: SeasonId): Season {
  const season = SEASONS.find((entry) => entry.id === id);
  if (!season) throw new Error(`unknown season id: ${id}`);
  return season;
}

/** The three months of a season, in year order (winter is Dec, Jan, Feb). */
export function monthsOfSeason(id: SeasonId): Month[] {
  const members = MONTHS.filter((month) => month.season === id);
  if (id !== 'winter') return members;
  // Winter reads Dec → Jan → Feb, not Jan → Feb → Dec: the season starts in
  // December, and a list in raw table order would look like a bug to a reader.
  return [...members.filter((m) => m.id === 'dec'), ...members.filter((m) => m.id !== 'dec')];
}
