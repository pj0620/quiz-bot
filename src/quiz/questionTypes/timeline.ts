import type { Grade, TimelineAnswer, TimelineQuestion } from '../types';
import {
  hasValidQuestionBase,
  normalizeAnswerText,
  numbered,
  type AnswerTranscript,
  type QuestionTypeLogic,
} from './contract';

/**
 * Two events is a true/false wearing a costume — there is only one way to be
 * wrong, and no room for partial credit.
 */
export const MIN_EVENTS = 3;

/** Above this, dragging six rows around a phone screen stops being pleasant. */
export const MAX_EVENTS = 6;

export type TimelineScore = {
  /** Ids of the events the reader put in exactly the right slot. */
  placedIds: string[];
  score: number;
};

/**
 * How much of the timeline is in the right place.
 *
 * Position-by-position: an event counts only when it sits in precisely the slot
 * it belongs in. That makes `score` and `parts` the same statement — every green
 * row is one of the events counted, so the number and the highlighting can never
 * disagree.
 *
 * The cost, which is real and deliberate: an answer shifted by one scores ZERO
 * rather than "nearly right", because no event is in its own slot even though
 * every relation between them is correct. Scoring the longest correctly-ordered
 * run instead would give that answer (n-1)/n. This is the one function to change
 * if that trade turns out to be the wrong way round.
 */
export function scoreTimeline(
  question: TimelineQuestion,
  answer: TimelineAnswer,
): TimelineScore {
  const placedIds: string[] = [];
  const seen = new Set<string>();

  question.events.forEach((event, index) => {
    /*
      Guarded against repeats as well as position. An answer stored before the
      question was edited can hold ids that no longer exist, or the same id
      twice — neither should be able to score more than once.
    */
    if (seen.has(event.id)) return;
    if (answer.order[index] !== event.id) return;
    seen.add(event.id);
    placedIds.push(event.id);
  });

  return {
    placedIds,
    score: question.events.length === 0 ? 0 : placedIds.length / question.events.length,
  };
}

export const timelineLogic: QuestionTypeLogic<TimelineQuestion> = {
  format: 'timeline',
  label: 'Put in order',
  icon: 'swap-vertical-outline',

  grade(question, answer): Grade {
    const { placedIds, score } = scoreTimeline(question, answer);

    // Sparse and true-only, like list-recall: the reveal renders the whole
    // timeline, so an absent key reads as "you didn't have this one here".
    const parts: Record<string, boolean> = {};
    for (const id of placedIds) parts[id] = true;

    const outcome = score === 1 ? 'correct' : score === 0 ? 'incorrect' : 'partial';
    return { status: 'graded', outcome, score, parts };
  },

  /*
    Every event has to be placed.

    Unlike list-recall, a short answer here is not partial recall — the reader
    starts with all the events already arranged, so there is no state in which
    some of them are legitimately unplaced. A short order means the answer was
    built from something stale.
  */
  isAnswerComplete(answer, question): boolean {
    return !!answer && answer.order.length === question.events.length;
  },

  isValid(value): value is TimelineQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<TimelineQuestion>;
    if (question.format !== 'timeline') return false;
    if (!Array.isArray(question.events)) return false;
    if (question.events.length < MIN_EVENTS) return false;
    if (question.events.length > MAX_EVENTS) return false;

    const ids = new Set<string>();
    const labels = new Set<string>();
    const dates = new Set<string>();

    for (const event of question.events) {
      if (!event || typeof event !== 'object') return false;

      // Grading is by id, so two events sharing one is ambiguous.
      if (typeof event.id !== 'string' || !event.id) return false;
      if (ids.has(event.id)) return false;
      ids.add(event.id);

      if (typeof event.label !== 'string' || !event.label.trim()) return false;

      /*
        Two events that READ the same cannot be ordered by anybody, and one of
        the two slots would be unwinnable however the reader answered. Compared
        loosely, because "Lee surrenders" and "Lee surrenders." are the same
        event with different punctuation.
      */
      const label = normalizeAnswerText(event.label);
      if (labels.has(label)) return false;
      labels.add(label);

      /*
        Dates are required, and must be DISTINCT.

        They are drawn as the fixed slots of the timeline the reader drags onto,
        so two events sharing a date text would draw two identical slots — and
        one of the two would be unwinnable however the reader answered. Compared
        loosely, so "1861" and "1861 " are one date.

        Note this is about the TEXT, not the year: "April 1861" and "July 1861"
        are distinct slots and a perfectly good question.
      */
      if (typeof event.date !== 'string' || !event.date.trim()) return false;
      const date = normalizeAnswerText(event.date);
      if (dates.has(date)) return false;
      dates.add(date);
    }

    return true;
  },

  summarize(question): string {
    return `Order ${question.events.length} events`;
  },

  transcribe(question, answer): AnswerTranscript {
    const labelOf = (id: string) => question.events.find((event) => event.id === id)?.label;
    // An id that no longer exists — an answer stored before an edit — is
    // dropped rather than printed raw, which would read as gibberish.
    const placed = answer?.order.map(labelOf).filter((label): label is string => !!label) ?? [];

    return {
      given: placed.length > 0 ? numbered(placed) : undefined,
      // Dates only on the answer key: hiding them until the reveal is the
      // entire format, and the reader's own order never carried them.
      expected: numbered(question.events.map((event) => `${event.label} — ${event.date}`)),
    };
  },
};

export function timelineAnswer(order: string[]): TimelineAnswer {
  return { format: 'timeline', order };
}
