import { topicMastery } from './srs/mastery';
import { computeStats, letterGrade, type LetterGrade, type Stats } from './stats';
import { formatTopic } from './topics';
import type { MasteryLevel, Question, ReviewState, Session } from './types';

/**
 * Stats by topic — what the Stats tab's "By topic" screens are computed from.
 *
 * A topic is the app's unit of SUBJECT, and this leans on that rather than
 * inventing another grouping. Notes carry their series or folder as a topic
 * (`generation/noteTopics.ts`), and vocabulary, geography and the calendar each
 * carry a fixed one — so the topic list already reads as the list of things
 * someone would call a subject, and it is the same grouping quiz rules and
 * mastery use. A second notion of "subject" would drift from it.
 *
 * Pure, like `stats.ts`, and for the same reasons: testable without a
 * renderer, and the screens stay layouts.
 */

export type TopicSummary = {
  topic: string;
  /** `formatTopic(topic)` — computed once so sorting and search don't redo it. */
  name: string;
  /** Questions carrying this topic. */
  total: number;
  /** Of `total`, never answered. Surfaced so 0% reads as "unstarted". */
  newCount: number;
  /** 0..1 — mean normalized mastery, the same figure `topicMastery` gives. */
  mastery: number;
  level: MasteryLevel;
  /** Graded answers the device still has a record of. */
  answered: number;
  correct: number;
  /** 0..1, or null when none of the topic's questions have been answered. */
  score: number | null;
  grade: LetterGrade | null;
  dueNow: number;
  /** When one of this topic's questions was last answered, or null if never. */
  lastAnsweredAt: number | null;
};

export type TopicSort = 'weakest' | 'strongest' | 'most-questions' | 'a-z';

export const TOPIC_SORTS: readonly { sort: TopicSort; label: string }[] = [
  { sort: 'weakest', label: 'Weakest first' },
  { sort: 'strongest', label: 'Strongest first' },
  { sort: 'most-questions', label: 'Most questions' },
  { sort: 'a-z', label: 'A to Z' },
];

/**
 * Which topics to show.
 *
 * `studied` is judged from review state, not from answer counts: session
 * history is capped, so a topic worked on months ago can have no answers on
 * record while its questions still plainly carry progress.
 */
export type TopicShow = 'all' | 'studied' | 'due';

export const TOPIC_SHOWS: readonly { show: TopicShow; label: string }[] = [
  { show: 'all', label: 'All' },
  { show: 'studied', label: 'Studied' },
  { show: 'due', label: 'Due now' },
];

export type TopicFilter = {
  /** Case-insensitive substring of the display name or the slug. */
  search: string;
  show: TopicShow;
  sort: TopicSort;
};

export function emptyTopicFilter(): TopicFilter {
  // Weakest first: the order the Stats tab already uses, because it is the
  // order someone should act on.
  return { search: '', show: 'all', sort: 'weakest' };
}

/**
 * One row per topic present on any question, in weakest-first order.
 *
 * A question in three topics counts towards all three, matching `topicMastery`
 * and `computeStats.topicScores`: splitting credit would understate each.
 */
export function summarizeTopics(input: {
  questions: readonly Question[];
  reviewStates: Readonly<Record<string, ReviewState>>;
  sessions: readonly Session[];
  now: number;
}): TopicSummary[] {
  const { questions, reviewStates, sessions, now } = input;

  // Answers resolve back to their question to know which topics they count
  // towards, so the lookup is built before the session pass.
  const byId = new Map(questions.map((question) => [question.id, question]));

  const answers = new Map<string, { answered: number; correct: number; last: number }>();
  for (const session of sessions) {
    for (const item of session.items) {
      // Unanswered items are skipped for the reason `computeStats` gives: an
      // abandoned session must not drag a topic's accuracy down.
      if (!item.outcome || item.answeredAt === undefined) continue;
      const wasCorrect = item.outcome === 'correct';

      for (const topic of byId.get(item.questionId)?.topics ?? []) {
        const bucket = answers.get(topic) ?? { answered: 0, correct: 0, last: 0 };
        bucket.answered += 1;
        if (wasCorrect) bucket.correct += 1;
        bucket.last = Math.max(bucket.last, item.answeredAt);
        answers.set(topic, bucket);
      }
    }
  }

  const due = new Map<string, number>();
  for (const question of questions) {
    // The same exclusions as the bank-wide due count: reported questions and
    // leeches are out of circulation, so counting them promises reviews that
    // selection will never hand over.
    if (question.flagged) continue;
    const state = reviewStates[question.id];
    if (!state || state.leech || now < state.dueAt) continue;
    for (const topic of question.topics) due.set(topic, (due.get(topic) ?? 0) + 1);
  }

  return topicMastery(questions, reviewStates).map((entry) => {
    const bucket = answers.get(entry.topic);
    const score = !bucket || bucket.answered === 0 ? null : bucket.correct / bucket.answered;
    return {
      topic: entry.topic,
      name: formatTopic(entry.topic),
      total: entry.total,
      newCount: entry.newCount,
      mastery: entry.score,
      level: entry.level,
      answered: bucket?.answered ?? 0,
      correct: bucket?.correct ?? 0,
      score,
      grade: score === null ? null : letterGrade(score),
      dueNow: due.get(entry.topic) ?? 0,
      lastAnsweredAt: bucket ? bucket.last : null,
    };
  });
}

function compareTopics(a: TopicSummary, b: TopicSummary, sort: TopicSort): number {
  switch (sort) {
    case 'weakest':
      // The order `topicMastery` already returns, restated so it survives a
      // filter having been applied. Bigger topics first among equals: a weak
      // topic with forty questions is more worth acting on than one with two.
      return a.mastery - b.mastery || b.total - a.total || a.topic.localeCompare(b.topic);
    case 'strongest':
      return b.mastery - a.mastery || b.total - a.total || a.topic.localeCompare(b.topic);
    case 'most-questions':
      return b.total - a.total || a.topic.localeCompare(b.topic);
    case 'a-z':
      return a.topic.localeCompare(b.topic);
  }
}

/** Filter, then sort — the "By topic" screen's whole pipeline in one call. */
export function applyTopicFilter(
  topics: readonly TopicSummary[],
  filter: TopicFilter,
): TopicSummary[] {
  const needle = filter.search.trim().toLowerCase();

  const matching = topics.filter((entry) => {
    if (filter.show === 'studied' && entry.newCount === entry.total) return false;
    if (filter.show === 'due' && entry.dueNow === 0) return false;
    if (needle && !entry.name.toLowerCase().includes(needle) && !entry.topic.includes(needle)) {
      return false;
    }
    return true;
  });

  return matching.sort((a, b) => compareTopics(a, b, filter.sort));
}

/**
 * The full Stats-tab picture, for one topic.
 *
 * Delegates to `computeStats` over the topic's questions and ONLY the answers
 * given to them, so every figure — accuracy, the 14-day chart, the daily
 * grades, the hardest questions — means the same thing it means on the main
 * tab, just scoped. A day streak comes back too; it is a streak of days this
 * topic was studied, which the screen has no use for and leaves out.
 */
export function computeTopicStats(input: {
  questions: readonly Question[];
  reviewStates: Readonly<Record<string, ReviewState>>;
  sessions: readonly Session[];
  now: number;
  topic: string;
}): Stats {
  const { questions, reviewStates, sessions, now, topic } = input;

  const scoped = questions.filter((question) => question.topics.includes(topic));
  const ids = new Set(scoped.map((question) => question.id));

  // A session shrinks to the items about this topic and drops out entirely
  // when it has none, so a "Daily quiz" that never touched the topic cannot
  // appear in its history with nothing in it.
  const narrowed: Session[] = [];
  for (const session of sessions) {
    const items = session.items.filter((item) => ids.has(item.questionId));
    if (items.length > 0) narrowed.push({ ...session, items });
  }

  return computeStats({ questions: scoped, reviewStates, sessions: narrowed, now });
}
