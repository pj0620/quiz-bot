import type { Question, Session } from '../types';
import { listGeographyQuestions } from './catalog';
import { GEOGRAPHY_SUBJECTS } from './types';

/**
 * Rebuilding a derived question from the id a session stored.
 *
 * This is the load-bearing seam of the whole feature. A session persists only
 * `questionId` per item and the player resolves those against the bank — but
 * geography questions are never in the bank, so without this a resumed session
 * would find nothing to render and show a reader an empty screen where their
 * half-finished quiz used to be.
 *
 * Two inputs make re-derivation exact, and BOTH are already persisted on the
 * session, which is the only reason this works at all:
 *
 *  - `seed` reproduces the distractors. Without it the reader would come back
 *    to the same question offering four different options — and worse, to a
 *    stored grade that was passed on options no longer on screen.
 *  - `startedAt` reproduces `addedAt`, which is set from the derivation clock.
 *
 * Every subject is indexed, not merely the enabled ones. Someone who switches
 * Europe off mid-session must still be able to finish the session they are in;
 * the preference governs what NEW sessions draw on, and nothing else.
 */

/** One derived catalog, keyed by the pair that determines it. */
type Index = { key: string; byId: Map<string, Question> };

/**
 * Only the most recent index is kept.
 *
 * Deriving all three subjects is a few hundred object literals over a table
 * already in memory — cheap, but not so cheap it should happen on every render
 * of a fifty-item results list. One entry is enough because the accesses that
 * matter are a burst against a single session.
 */
let cached: Index | null = null;

function indexFor(seed: number, now: number): Map<string, Question> {
  const key = `${seed}:${now}`;
  if (cached?.key === key) return cached.byId;

  const questions = listGeographyQuestions(GEOGRAPHY_SUBJECTS, seed, now);
  const byId = new Map(questions.map((question) => [question.id, question]));
  cached = { key, byId };
  return byId;
}

export function resolveGeographyQuestion(
  id: string,
  seed: number,
  now: number,
): Question | undefined {
  return indexFor(seed, now).get(id);
}

/**
 * The derived questions a session refers to.
 *
 * Returns only what the session actually holds, so callers can concatenate it
 * with the bank without the rest of the catalog leaking into a results screen
 * or a question count.
 */
export function resolveSessionGeography(session: Session): Question[] {
  const byId = indexFor(session.seed, session.startedAt);
  const questions: Question[] = [];
  for (const item of session.items) {
    const question = byId.get(item.questionId);
    if (question) questions.push(question);
  }
  return questions;
}

/** Test seam: the cache is a memo, and a stale one must not cross a test. */
export function resetGeographyCache(): void {
  cached = null;
}
