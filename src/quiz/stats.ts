import { addDays, daysBetween, startOfDay } from '../lib/day';
import { masteryOf, MASTERY_ORDER } from './srs/mastery';
import type { MasteryLevel, Question, ReviewState, Session } from './types';

/**
 * Everything the Stats screen shows, computed in one pure pass.
 *
 * Pure so the arithmetic — streaks across DST boundaries, what counts as an
 * answer, which questions are "due" — is testable without a renderer, and so
 * the screen stays a layout with no logic in it.
 *
 * One honest limitation runs through all of this: session history is capped
 * (`MAX_STORED_SESSIONS`), so activity older than the last ~20 sessions is gone.
 * Counts here describe what the device still remembers, not all time, and the
 * screen says so rather than implying a complete record.
 */

const DEFAULT_ACTIVITY_DAYS = 14;
const DEFAULT_WEEK_DAYS = 7;
const MAX_HARDEST = 5;

export const MASTERY_LEVELS: MasteryLevel[] = ['new', 'learning', 'shaky', 'familiar', 'solid'];

export type MasterySlice = { level: MasteryLevel; count: number };

export type ActivityDay = {
  /** 0 is today, -1 yesterday. */
  dayOffset: number;
  reviewed: number;
  correct: number;
};

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * A day's accuracy as a letter, on the usual 90/80/70/60 boundaries.
 *
 * `score` is 0..1. Kept here rather than in the component because where the
 * boundaries fall is a judgement about the app, not about how a dot looks.
 */
export function letterGrade(score: number): LetterGrade {
  const percent = score * 100;
  if (percent >= 90) return 'A';
  if (percent >= 80) return 'B';
  if (percent >= 70) return 'C';
  if (percent >= 60) return 'D';
  return 'F';
}

export type DayScore = {
  /** 0 is today, -1 yesterday. */
  dayOffset: number;
  answered: number;
  correct: number;
  /**
   * 0..1, or null when nothing was answered that day.
   *
   * Null rather than 0 so a skipped day can be drawn as "didn't study" instead
   * of being coloured as a day where everything was got wrong.
   */
  score: number | null;
  grade: LetterGrade | null;
};

export type SessionScore = {
  id: string;
  quizName: string;
  at: number;
  correct: number;
  total: number;
};

export type TopicScore = {
  answered: number;
  correct: number;
  /** 0..1, or null when none of the topic's questions have been answered. */
  score: number | null;
  grade: LetterGrade | null;
};

export type HardQuestion = {
  questionId: string;
  prompt: string;
  lapses: number;
  leech: boolean;
};

export type Stats = {
  /** Graded answers the device still has a record of. */
  answered: number;
  correct: number;
  /** 0..1, or null when nothing has been answered yet. */
  accuracy: number | null;
  /** Consecutive days with at least one answer, ending today or yesterday. */
  dayStreak: number;
  reviewedToday: number;
  bankTotal: number;
  dueNow: number;
  mastery: MasterySlice[];
  /** Oldest first, one entry per day, gaps included as zeroes. */
  activity: ActivityDay[];
  /** Oldest first, one entry per day, skipped days included with a null score. */
  week: DayScore[];
  /**
   * How well each topic has actually been answered, by topic id.
   *
   * Separate from mastery on purpose: mastery says how well the SCHEDULE thinks
   * you know something, which is zero for anything unseen. A grade is about the
   * answers you have given, so a topic you have never been asked about has no
   * grade at all rather than an F.
   */
  topicScores: Record<string, TopicScore>;
  /** Most recent first. */
  recentSessions: SessionScore[];
  /** Questions lapsed most often — what to actually go and re-read. */
  hardest: HardQuestion[];
};

/**
 * A streak survives today being empty.
 *
 * Ending it at midnight would mean the number drops to zero every morning
 * before the day's first review — technically true, and useless. It breaks only
 * once a whole day has passed with nothing in it.
 */
function computeDayStreak(activeDays: ReadonlySet<number>, now: number): number {
  const today = startOfDay(now);
  let cursor = activeDays.has(today) ? today : addDays(today, -1);
  if (!activeDays.has(cursor)) return 0;

  let streak = 0;
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function computeStats(input: {
  questions: readonly Question[];
  reviewStates: Readonly<Record<string, ReviewState>>;
  sessions: readonly Session[];
  now: number;
  activityDays?: number;
  weekDays?: number;
}): Stats {
  const { questions, reviewStates, sessions, now } = input;
  const activityDays = input.activityDays ?? DEFAULT_ACTIVITY_DAYS;
  const weekDays = input.weekDays ?? DEFAULT_WEEK_DAYS;
  // Both windows read from the same per-day tally, so it has to span whichever
  // is longer or the shorter chart would silently lose its oldest days.
  const trackedDays = Math.max(activityDays, weekDays);

  // ---- answers, from session items -------------------------------------
  let answered = 0;
  let correct = 0;
  const activeDays = new Set<number>();
  const perDay = new Map<number, { reviewed: number; correct: number }>();
  const perTopic = new Map<string, { answered: number; correct: number }>();

  // Built up front rather than only for `hardest`, because an answer has to be
  // resolved back to its question to know which topics it counts towards.
  const byId = new Map(questions.map((question) => [question.id, question]));

  for (const session of sessions) {
    for (const item of session.items) {
      // An item without an outcome was never answered — skipping it is what
      // keeps accuracy honest when a session is abandoned part-way.
      if (!item.outcome || item.answeredAt === undefined) continue;

      answered += 1;
      const wasCorrect = item.outcome === 'correct';
      if (wasCorrect) correct += 1;

      // A question in three topics counts towards all three, matching how
      // `topicMastery` treats them: splitting credit would understate each.
      for (const topic of byId.get(item.questionId)?.topics ?? []) {
        const bucket = perTopic.get(topic) ?? { answered: 0, correct: 0 };
        bucket.answered += 1;
        if (wasCorrect) bucket.correct += 1;
        perTopic.set(topic, bucket);
      }

      const day = startOfDay(item.answeredAt);
      activeDays.add(day);

      const offset = daysBetween(item.answeredAt, now);
      if (offset >= 0 && offset < trackedDays) {
        const bucket = perDay.get(-offset) ?? { reviewed: 0, correct: 0 };
        bucket.reviewed += 1;
        if (wasCorrect) bucket.correct += 1;
        perDay.set(-offset, bucket);
      }
    }
  }

  // Every day in the window, including empty ones — a bar chart with gaps
  // silently collapsed would misrepresent consistency.
  const activity: ActivityDay[] = [];
  for (let offset = -(activityDays - 1); offset <= 0; offset += 1) {
    const bucket = perDay.get(offset) ?? { reviewed: 0, correct: 0 };
    activity.push({ dayOffset: offset, reviewed: bucket.reviewed, correct: bucket.correct });
  }

  // Same window treatment as `activity`: every day present, so a skipped day
  // occupies its place in the row rather than the week closing up around it.
  const week: DayScore[] = [];
  for (let offset = -(weekDays - 1); offset <= 0; offset += 1) {
    const bucket = perDay.get(offset) ?? { reviewed: 0, correct: 0 };
    const score = bucket.reviewed === 0 ? null : bucket.correct / bucket.reviewed;
    week.push({
      dayOffset: offset,
      answered: bucket.reviewed,
      correct: bucket.correct,
      score,
      grade: score === null ? null : letterGrade(score),
    });
  }

  // ---- mastery and due, from review states ------------------------------
  const counts = new Map<MasteryLevel, number>(MASTERY_LEVELS.map((level) => [level, 0]));
  let dueNow = 0;

  for (const question of questions) {
    // Flagged questions are out of circulation, so counting them would inflate
    // both the bank's mastery and its due total with cards nobody will see.
    if (question.flagged) continue;

    const state = reviewStates[question.id];
    const level = masteryOf(state);
    counts.set(level, (counts.get(level) ?? 0) + 1);

    // Leeches are out of circulation, so counting them as due would promise
    // work that selection will never actually hand over.
    if (!state || state.leech) continue;
    if (now >= state.dueAt) dueNow += 1;
  }

  // ---- recent sessions ---------------------------------------------------
  const recentSessions: SessionScore[] = sessions
    .filter((session) => session.status === 'completed')
    .map((session) => {
      let sessionCorrect = 0;
      let total = 0;
      for (const item of session.items) {
        if (!item.outcome) continue;
        total += 1;
        if (item.outcome === 'correct') sessionCorrect += 1;
      }
      return {
        id: session.id,
        quizName: session.quizName,
        at: session.completedAt ?? session.startedAt,
        correct: sessionCorrect,
        total,
      };
    })
    .filter((score) => score.total > 0)
    .sort((a, b) => b.at - a.at);

  // ---- per-topic grades --------------------------------------------------
  const topicScores: Record<string, TopicScore> = {};
  for (const [topic, bucket] of perTopic) {
    const score = bucket.answered === 0 ? null : bucket.correct / bucket.answered;
    topicScores[topic] = {
      answered: bucket.answered,
      correct: bucket.correct,
      score,
      grade: score === null ? null : letterGrade(score),
    };
  }

  // ---- hardest questions -------------------------------------------------
  const hardest: HardQuestion[] = Object.values(reviewStates)
    .filter((state) => state.lapses > 0 && byId.has(state.questionId))
    .sort((a, b) => b.lapses - a.lapses || a.questionId.localeCompare(b.questionId))
    .slice(0, MAX_HARDEST)
    .map((state) => ({
      questionId: state.questionId,
      prompt: byId.get(state.questionId)?.prompt ?? '',
      lapses: state.lapses,
      leech: state.leech === true,
    }));

  return {
    answered,
    correct,
    accuracy: answered === 0 ? null : correct / answered,
    dayStreak: computeDayStreak(activeDays, now),
    reviewedToday: perDay.get(0)?.reviewed ?? 0,
    bankTotal: questions.length,
    dueNow,
    mastery: MASTERY_LEVELS.map((level) => ({ level, count: counts.get(level) ?? 0 })),
    activity,
    week,
    topicScores,
    recentSessions,
    hardest,
  };
}

/** How far along the mastery scale the whole bank sits, 0..1. */
export function overallMastery(mastery: readonly MasterySlice[]): number {
  let total = 0;
  let sum = 0;
  for (const slice of mastery) {
    total += slice.count;
    sum += slice.count * (MASTERY_ORDER[slice.level] / MASTERY_ORDER.solid);
  }
  return total === 0 ? 0 : sum / total;
}
