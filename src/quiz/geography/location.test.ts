import type { Question, QuestionBase } from '../types';
import { geographyLocationOf, listGeographyQuestions } from './catalog';
import { GEOGRAPHY_SUBJECTS } from './types';

/*
  Which map and region a question is about.

  This is what the screens branch on to route geography past the "From your
  notes" card, so a wrong answer here is not a cosmetic miss. A derived question
  stores `us-states/us-tn` as its provenance path, and `NoteSource` reads a path
  as a FILE — it offers "Read the full note" and then resolves a source called
  `geography` that has never existed. Returning null for a geography question
  puts the reader back in front of exactly that.
*/

const NOW = 1_760_000_000_000;

const noteBase: QuestionBase = {
  id: 'q1',
  prompt: 'Which state did Lincoln keep troops out of early in the war?',
  explanation: 'Kentucky.',
  topics: ['history-of-america'],
  difficulty: 'core',
  sourceId: 'github-repo:1',
  provenance: { sourceId: 'github-repo:1', path: 'History/Border States.md' },
  addedAt: NOW,
};

describe('geographyLocationOf', () => {
  it('reads a map question straight off its target', () => {
    const question = listGeographyQuestions(['us-states'], 1, NOW).find(
      (candidate) => candidate.format === 'map-locate',
    );
    if (question?.format !== 'map-locate') throw new Error('expected a map question');

    expect(geographyLocationOf(question)).toEqual({
      mapId: 'us-states',
      regionId: question.targetRegionId,
    });
  });

  it('reads a shape question off its figure', () => {
    const question = listGeographyQuestions(['europe'], 1, NOW).find(
      (candidate) => candidate.format === 'short-answer',
    );
    if (!question) throw new Error('expected a shape question');

    expect(geographyLocationOf(question)).toEqual({
      mapId: 'europe',
      regionId: question.figure?.regionId,
    });
  });

  it('finds a location for every question the catalog derives', () => {
    // The screens use this as the geography test. Anything it misses falls
    // through to `NoteSource` and goes looking for a note that is not there.
    for (const question of listGeographyQuestions(GEOGRAPHY_SUBJECTS, 1, NOW)) {
      expect(geographyLocationOf(question)).not.toBeNull();
    }
  });

  it('names the map the question was actually drawn from', () => {
    for (const subject of GEOGRAPHY_SUBJECTS) {
      for (const question of listGeographyQuestions([subject], 1, NOW)) {
        expect(geographyLocationOf(question)?.mapId).toBe(subject);
      }
    }
  });

  it('returns null for a question written from a note', () => {
    const question: Question = {
      ...noteBase,
      format: 'short-answer',
      modelAnswer: 'Kentucky',
    };
    expect(geographyLocationOf(question)).toBeNull();
  });

  it('does not depend on the reserved source id', () => {
    /*
      Read off the question's own shape rather than its `sourceId`, so it stays
      correct for a question that carries a map figure without having come from
      the catalog — and so the screens never have to ask two questions to
      answer one.
    */
    const question: Question = {
      ...noteBase,
      format: 'multiple-choice',
      choices: [
        { id: 'a', text: 'Tennessee' },
        { id: 'b', text: 'Kentucky' },
      ],
      correctChoiceId: 'a',
      figure: { kind: 'region-shape', mapId: 'us-states', regionId: 'us-tn' },
    };

    expect(geographyLocationOf(question)).toEqual({ mapId: 'us-states', regionId: 'us-tn' });
  });
});
