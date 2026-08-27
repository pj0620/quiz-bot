import { isWithinDays } from '../lib/day';
import { masteryOf } from './srs/mastery';
import type { Difficulty, MasteryLevel, Question, QuestionFormat, ReviewState } from './types';

/**
 * The question-bank browser's filter, as ONE VALUE.
 *
 * The browser used to hold each filter in its own useState, combined ad hoc in
 * a `useMemo` — fine at three filters, and exactly the design that stops
 * scaling at four. One object filtered by one pure function buys three things:
 *
 *  - Adding a filter is a field here and a clause in `matchesBankFilter`,
 *    never a rewrite of the screen.
 *  - The whole thing is testable without rendering anything.
 *  - "How many filters are on?" and "clear them all" become trivial, and
 *    those are what keep a filter UI honest once it grows a sheet.
 *
 * Every dimension is a LIST (any-of), because that is how people actually
 * narrow a big bank: "multiple choice or true/false, from these two topics".
 * The old single-select chips were a special case of this with length one.
 */
export type BankSort = 'newest' | 'oldest' | 'a-z' | 'weakest';

export type BankFilter = {
  /** Case-insensitive substring of the prompt. */
  search: string;
  /** Match ANY of these topics. Empty = no constraint. */
  topics: string[];
  formats: QuestionFormat[];
  difficulties: Difficulty[];
  /** Match ANY of these mastery levels, derived from review state. */
  mastery: MasteryLevel[];
  /** Only questions added within the last N calendar days. */
  addedWithinDays?: number;
  flaggedOnly: boolean;
  sort: BankSort;
};

/** The windows the UI offers. Calendar days, matching `QuizRule.addedWithinDays`. */
export const ADDED_WINDOWS: readonly { days: number; label: string }[] = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
];

export const BANK_SORTS: readonly { sort: BankSort; label: string }[] = [
  { sort: 'newest', label: 'Newest first' },
  { sort: 'oldest', label: 'Oldest first' },
  { sort: 'a-z', label: 'A to Z' },
  { sort: 'weakest', label: 'Weakest first' },
];

export function emptyBankFilter(): BankFilter {
  return {
    search: '',
    topics: [],
    formats: [],
    difficulties: [],
    mastery: [],
    flaggedOnly: false,
    // Newest first: the question you generated a minute ago is the one you
    // came to check on, and under insertion order it was at the very bottom.
    sort: 'newest',
  };
}

/**
 * How many constraints are active — the badge on the Filters button, and the
 * honesty check for "why is my list short?". Search is excluded because its
 * field is always visible; sort because it narrows nothing.
 */
export function countActiveFilters(filter: BankFilter): number {
  return (
    filter.topics.length +
    filter.formats.length +
    filter.difficulties.length +
    filter.mastery.length +
    (filter.addedWithinDays !== undefined ? 1 : 0) +
    (filter.flaggedOnly ? 1 : 0)
  );
}

export function matchesBankFilter(
  question: Question,
  filter: BankFilter,
  reviewState: ReviewState | undefined,
  now: number,
): boolean {
  if (filter.flaggedOnly && !question.flagged) return false;

  // ANY, not ALL — the same reading `matchesRule` gives a quiz rule's topics.
  if (filter.topics.length > 0 && !question.topics.some((topic) => filter.topics.includes(topic))) {
    return false;
  }

  if (filter.formats.length > 0 && !filter.formats.includes(question.format)) return false;

  if (filter.difficulties.length > 0 && !filter.difficulties.includes(question.difficulty)) {
    return false;
  }

  if (filter.mastery.length > 0 && !filter.mastery.includes(masteryOf(reviewState))) return false;

  // addedAt — when it entered the local bank — for the reason `matchesRule`
  // gives: "new to me" is the useful question, not "committed recently".
  if (filter.addedWithinDays !== undefined) {
    if (!isWithinDays(question.addedAt, filter.addedWithinDays, now)) return false;
  }

  if (filter.search.trim()) {
    const needle = filter.search.trim().toLowerCase();
    if (!question.prompt.toLowerCase().includes(needle)) return false;
  }

  return true;
}

/**
 * Weakest-first ranking. Deliberately NOT the mastery ladder's own order:
 * 'new' sits between the struggling levels and the comfortable ones, because
 * a question you keep missing needs you more than one you have never met,
 * and one you have never met needs you more than one you know.
 */
const WEAKNESS_RANK: Record<MasteryLevel, number> = {
  shaky: 0,
  learning: 1,
  new: 2,
  familiar: 3,
  solid: 4,
};

export function sortQuestions(
  questions: readonly Question[],
  sort: BankSort,
  reviewStates: Readonly<Record<string, ReviewState>>,
): Question[] {
  const sorted = [...questions];
  switch (sort) {
    case 'newest':
      // Prompt as the tiebreak, so a whole generation run (one addedAt) lists
      // in a stable, scannable order instead of insertion happenstance.
      sorted.sort((a, b) => b.addedAt - a.addedAt || a.prompt.localeCompare(b.prompt));
      break;
    case 'oldest':
      sorted.sort((a, b) => a.addedAt - b.addedAt || a.prompt.localeCompare(b.prompt));
      break;
    case 'a-z':
      sorted.sort((a, b) => a.prompt.localeCompare(b.prompt));
      break;
    case 'weakest':
      sorted.sort(
        (a, b) =>
          WEAKNESS_RANK[masteryOf(reviewStates[a.id])] - WEAKNESS_RANK[masteryOf(reviewStates[b.id])] ||
          a.prompt.localeCompare(b.prompt),
      );
      break;
  }
  return sorted;
}

/** Filter, then sort — the browser's whole pipeline in one call. */
export function applyBankFilter(
  questions: readonly Question[],
  filter: BankFilter,
  reviewStates: Readonly<Record<string, ReviewState>>,
  now: number,
): Question[] {
  const matching = questions.filter((question) =>
    matchesBankFilter(question, filter, reviewStates[question.id], now),
  );
  return sortQuestions(matching, filter.sort, reviewStates);
}
