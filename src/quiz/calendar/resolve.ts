import type { Question, Session } from '../types';
import { listCalendarQuestions } from './catalog';
import { CALENDAR_SUBJECTS } from './types';

/**
 * Rebuilding a derived calendar question from the id a session stored.
 *
 * The same load-bearing seam `geography/resolve.ts` documents at length: a
 * session persists only `questionId` per item, calendar questions are never
 * in the bank, and `seed` + `startedAt` are both persisted on the session —
 * which is what makes re-derivation exact.
 *
 * Every subject is indexed, not merely the enabled ones: someone who switches
 * holidays off mid-session must still be able to finish the session they are
 * in. The preference governs what NEW sessions draw on, and nothing else.
 */

/** One derived catalog, keyed by the pair that determines it. */
type Index = { key: string; byId: Map<string, Question> };

/** Only the most recent index is kept — see `geography/resolve.ts` for why one is enough. */
let cached: Index | null = null;

function indexFor(seed: number, now: number): Map<string, Question> {
  const key = `${seed}:${now}`;
  if (cached?.key === key) return cached.byId;

  const questions = listCalendarQuestions(CALENDAR_SUBJECTS, seed, now);
  const byId = new Map(questions.map((question) => [question.id, question]));
  cached = { key, byId };
  return byId;
}

export function resolveCalendarQuestion(
  id: string,
  seed: number,
  now: number,
): Question | undefined {
  return indexFor(seed, now).get(id);
}

/**
 * The derived questions a session refers to. Returns only what the session
 * actually holds, so callers can concatenate it with the bank without the
 * rest of the catalog leaking into a results screen or a question count.
 */
export function resolveSessionCalendar(session: Session): Question[] {
  const byId = indexFor(session.seed, session.startedAt);
  const questions: Question[] = [];
  for (const item of session.items) {
    const question = byId.get(item.questionId);
    if (question) questions.push(question);
  }
  return questions;
}

/** Test seam: the cache is a memo, and a stale one must not cross a test. */
export function resetCalendarCache(): void {
  cached = null;
}
