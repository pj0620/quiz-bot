import type { MasteryLevel, Question, ReviewState } from '../types';
import { isNew } from './schedule';

/**
 * Mastery is a DISPLAY concept only. It never feeds back into scheduling —
 * `schedule.ts` works from ease/interval/lapses directly. Keeping the two
 * separate means tuning how mastery reads to the user can't accidentally change
 * how often they see a question.
 */

export const MASTERY_ORDER: Record<MasteryLevel, number> = {
  new: 0,
  learning: 1,
  shaky: 2,
  familiar: 3,
  solid: 4,
};

const SOLID_INTERVAL_DAYS = 21;
const FAMILIAR_INTERVAL_DAYS = 7;

export function masteryOf(state: ReviewState | undefined): MasteryLevel {
  if (isNew(state)) return 'new';

  // A question you keep getting wrong is 'shaky' regardless of how long its
  // interval has grown — recent failures matter more than accumulated reps.
  if (state.leech || state.lastOutcome === 'incorrect') return 'shaky';
  if (state.lapses >= 2 && state.streak < 2) return 'shaky';

  if (state.intervalDays >= SOLID_INTERVAL_DAYS && state.streak >= 3) return 'solid';
  if (state.intervalDays >= FAMILIAR_INTERVAL_DAYS && state.streak >= 2) return 'familiar';
  return 'learning';
}

export function isAtOrBelowMastery(state: ReviewState | undefined, ceiling: MasteryLevel): boolean {
  return MASTERY_ORDER[masteryOf(state)] <= MASTERY_ORDER[ceiling];
}

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  new: 'New',
  learning: 'Learning',
  shaky: 'Shaky',
  familiar: 'Familiar',
  solid: 'Solid',
};

export type TopicMastery = {
  topic: string;
  /** 0..1 — mean normalized mastery across the topic's questions. */
  score: number;
  level: MasteryLevel;
  total: number;
  /** Questions never answered. Surfaced separately so 0% reads as "unstarted". */
  newCount: number;
};

/**
 * Aggregates per-topic mastery.
 *
 * A question in three topics counts toward all three — topics overlap by
 * design, and splitting credit would understate every topic.
 */
export function topicMastery(
  questions: readonly Question[],
  reviewStates: Readonly<Record<string, ReviewState>>,
): TopicMastery[] {
  const buckets = new Map<string, { sum: number; total: number; newCount: number }>();

  for (const question of questions) {
    const level = masteryOf(reviewStates[question.id]);
    const normalized = MASTERY_ORDER[level] / MASTERY_ORDER.solid;

    for (const topic of question.topics) {
      const bucket = buckets.get(topic) ?? { sum: 0, total: 0, newCount: 0 };
      bucket.sum += normalized;
      bucket.total += 1;
      if (level === 'new') bucket.newCount += 1;
      buckets.set(topic, bucket);
    }
  }

  return Array.from(buckets, ([topic, bucket]) => {
    const score = bucket.total === 0 ? 0 : bucket.sum / bucket.total;
    return {
      topic,
      score,
      level: levelFromScore(score),
      total: bucket.total,
      newCount: bucket.newCount,
    };
  }).sort(
    // Weakest first — that's what the user should act on. Stable tiebreak so
    // the list doesn't reshuffle between renders.
    (a, b) => a.score - b.score || b.total - a.total || a.topic.localeCompare(b.topic),
  );
}

function levelFromScore(score: number): MasteryLevel {
  const scaled = score * MASTERY_ORDER.solid;
  if (scaled >= 3.5) return 'solid';
  if (scaled >= 2.5) return 'familiar';
  if (scaled >= 1.5) return 'shaky';
  if (scaled > 0) return 'learning';
  return 'new';
}
