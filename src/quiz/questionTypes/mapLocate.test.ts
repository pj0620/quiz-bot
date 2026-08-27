import type { MapLocateQuestion, QuestionBase } from '../types';
import { isGraded } from '../types';
import { mapLocateAnswer } from './mapLocate';
import { gradeAnswer, isAnswerComplete, isValidQuestion } from './registry';

const base: QuestionBase = {
  id: 'geo-1',
  prompt: 'Tap Tennessee on the map.',
  explanation: 'Tennessee is highlighted once you answer.',
  topics: ['geography', 'us-states'],
  difficulty: 'core',
  sourceId: 'geography',
  provenance: { sourceId: 'geography', path: 'us-states/us-tn' },
  addedAt: 1_760_000_000_000,
};

const question: MapLocateQuestion = {
  ...base,
  format: 'map-locate',
  mapId: 'us-states',
  targetRegionId: 'us-tn',
  regionIds: ['us-tn', 'us-ky', 'us-va', 'us-ga'],
};

describe('grading', () => {
  it('marks the target correct', () => {
    const grade = gradeAnswer(question, mapLocateAnswer('us-tn'));
    expect(isGraded(grade) && grade.outcome).toBe('correct');
  });

  it('marks anything else incorrect', () => {
    const grade = gradeAnswer(question, mapLocateAnswer('us-ga'));
    expect(isGraded(grade) && grade.outcome).toBe('incorrect');
  });

  it('gives a neighbour no credit at all', () => {
    /*
      Tempting to score Kentucky at half marks — it does border Tennessee. But
      the two mistakes are the same mistake, and partial credit would feed the
      review schedule a softer signal than was earned, drifting a state the
      reader cannot place back out of rotation while it is still unplaceable.
    */
    const grade = gradeAnswer(question, mapLocateAnswer('us-ky'));
    expect(isGraded(grade) && grade.score).toBe(0);
  });
});

describe('completeness', () => {
  it('is incomplete until something has been tapped', () => {
    expect(isAnswerComplete(question, null)).toBe(false);
    expect(isAnswerComplete(question, mapLocateAnswer(''))).toBe(false);
  });

  it('is complete once a region is picked, right or wrong', () => {
    expect(isAnswerComplete(question, mapLocateAnswer('us-ga'))).toBe(true);
  });
});

describe('validation', () => {
  it('accepts a well-formed question', () => {
    expect(isValidQuestion(question)).toBe(true);
  });

  it('rejects a target that is not drawn, which would be unanswerable', () => {
    expect(isValidQuestion({ ...question, targetRegionId: 'us-or' })).toBe(false);
  });

  it('rejects a region id that no longer exists in the map data', () => {
    expect(isValidQuestion({ ...question, regionIds: [...question.regionIds, 'us-zz'] })).toBe(
      false,
    );
  });

  it('rejects an unknown map, which would render an empty screen', () => {
    expect(isValidQuestion({ ...question, mapId: 'atlantis' })).toBe(false);
  });

  it('rejects a map with nothing to choose between', () => {
    expect(
      isValidQuestion({ ...question, targetRegionId: 'us-tn', regionIds: ['us-tn'] }),
    ).toBe(false);
  });

  it('rejects a malformed figure without taking the rest of the batch with it', () => {
    // The figure lives on the base, so this guards every format, not just this
    // one — a shape question whose picture cannot be drawn is unanswerable.
    expect(isValidQuestion({ ...question, figure: { kind: 'region-shape' } })).toBe(false);
    expect(isValidQuestion({ ...question, figure: null })).toBe(false);
  });

  it('still accepts a question with no figure at all', () => {
    // Every note-derived question in the bank is this case.
    expect(isValidQuestion({ ...question, figure: undefined })).toBe(true);
  });
});
