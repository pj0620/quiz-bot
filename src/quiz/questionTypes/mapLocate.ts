import { getRegion, getRegionMap } from '../geography/maps';
import type { Grade, MapLocateAnswer, MapLocateQuestion } from '../types';
import { hasValidQuestionBase, type AnswerTranscript, type QuestionTypeLogic } from './contract';

/**
 * "Tap Tennessee on the map."
 *
 * The logic is thin because the format is: an answer is a region id, and it is
 * either the right one or it is not. What is worth stating is what this
 * deliberately does NOT do.
 *
 * NO PARTIAL CREDIT FOR A NEIGHBOUR. Tapping Kentucky when asked for Tennessee
 * is tempting to score at half marks — it is, after all, closer than tapping
 * Oregon. But the two mistakes are the same mistake: you did not know where
 * Tennessee was. Paying out for proximity would also feed the review schedule a
 * softer signal than the reader earned, so a state they cannot place would drift
 * out of rotation while still being unplaceable.
 *
 * NO COORDINATES ANYWHERE. The answer is the region the reader hit, not the
 * point they touched. Hit-testing is the view's job and it happens once; storing
 * a point would mean re-deciding what it hit every time a result is rendered,
 * against map data that may since have been rebuilt at a different detail tier.
 */
export const mapLocateLogic: QuestionTypeLogic<MapLocateQuestion> = {
  format: 'map-locate',
  label: 'Find on map',
  icon: 'map-outline',

  grade(question, answer): Grade {
    const correct = answer.regionId === question.targetRegionId;
    return { status: 'graded', outcome: correct ? 'correct' : 'incorrect', score: correct ? 1 : 0 };
  },

  isAnswerComplete(answer): boolean {
    return !!answer?.regionId;
  },

  isValid(value): value is MapLocateQuestion {
    if (!hasValidQuestionBase(value)) return false;
    const question = value as Partial<MapLocateQuestion>;
    if (question.format !== 'map-locate') return false;

    if (typeof question.mapId !== 'string') return false;
    // An unknown map is unrenderable, and a question pointing at one would show
    // the reader an empty screen with no way to answer it.
    const map = getRegionMap(question.mapId);
    if (!map) return false;

    if (typeof question.targetRegionId !== 'string' || !question.targetRegionId) return false;
    if (!Array.isArray(question.regionIds) || question.regionIds.length < 2) return false;
    if (!question.regionIds.every((id) => typeof id === 'string')) return false;

    // The mirror of multiple-choice's "correct answer must be among the
    // choices": a target that is not drawn cannot be tapped, so the question is
    // impossible rather than merely hard.
    if (!question.regionIds.includes(question.targetRegionId)) return false;

    return question.regionIds.every((id) => !!getRegion(question.mapId as string, id));
  },

  summarize(question): string {
    const map = getRegionMap(question.mapId);
    return map ? `Find on the ${map.label} map` : 'Find on a map';
  },

  transcribe(question, answer): AnswerTranscript {
    /*
      Named, never id'd, and never positional.

      Whoever reads a transcript has no map and no region table — `us-tn` means
      nothing to them, and "the one in the middle" means nothing to anybody. The
      names are the only part of this question that survives being written down.
    */
    const nameOf = (id: string | undefined) =>
      id ? (getRegion(question.mapId, id)?.name ?? id) : undefined;
    const map = getRegionMap(question.mapId);

    return {
      detail: map ? `Shown the ${map.label} map and asked to tap one region.` : undefined,
      given: nameOf(answer?.regionId),
      expected: nameOf(question.targetRegionId) ?? '(unknown)',
    };
  },
};

export function mapLocateAnswer(regionId: string): MapLocateAnswer {
  return { format: 'map-locate', regionId };
}
