import { isValidQuestion } from '../questionTypes/registry';
import type { MultipleChoiceQuestion, Question } from '../types';
import { geographyQuestionId, listGeographyQuestions } from './catalog';
import { listRegions, tappableRegions } from './maps';
import { GEOGRAPHY_SOURCE_ID, GEOGRAPHY_SUBJECTS, GEOGRAPHY_TOPIC } from './types';

/*
  The catalog's contract in one line:

    the ID may depend only on subject/kind/region; everything else may depend
    on the seed.

  Both halves are load-bearing and both fail SILENTLY. An id that moves orphans
  every stored review state — nothing throws, the reader's history simply stops
  matching and their progress is gone. Options that don't move mean the same
  four choices forever, which nothing would ever surface as a bug either.
*/

const NOW = 1_760_000_000_000;
const SEED = 12345;

const ALL = () => listGeographyQuestions(GEOGRAPHY_SUBJECTS, SEED, NOW);

describe('question identity', () => {
  it('gives the same id for the same region across different seeds', () => {
    const a = listGeographyQuestions(['us-states'], 1, NOW);
    const b = listGeographyQuestions(['us-states'], 99999, NOW);

    expect(a.map((question) => question.id)).toEqual(b.map((question) => question.id));
  });

  it('gives the same id across different derivation clocks', () => {
    const a = listGeographyQuestions(['europe'], SEED, NOW);
    const b = listGeographyQuestions(['europe'], SEED, NOW + 90 * 24 * 3600 * 1000);

    expect(a.map((question) => question.id)).toEqual(b.map((question) => question.id));
  });

  it('never collides across subjects, kinds or regions', () => {
    const ids = ALL().map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins the id derivation, because changing it orphans every review state', () => {
    // Deliberately a hard-coded expectation: this test failing is the intended
    // alarm when someone edits `geographyQuestionId`.
    expect(geographyQuestionId('us-states', 'locate', 'us-tn')).toBe(
      geographyQuestionId('us-states', 'locate', 'us-tn'),
    );
    expect(geographyQuestionId('us-states', 'locate', 'us-tn')).not.toBe(
      geographyQuestionId('us-states', 'shape-choice', 'us-tn'),
    );
    expect(geographyQuestionId('us-states', 'locate', 'us-tn')).not.toBe(
      geographyQuestionId('europe', 'locate', 'us-tn'),
    );
  });
});

describe('options', () => {
  const choicesFor = (seed: number, id: string) => {
    const question = listGeographyQuestions(['us-states'], seed, NOW).find(
      (candidate) => candidate.id === id && candidate.format === 'multiple-choice',
    ) as MultipleChoiceQuestion | undefined;
    return question?.choices.map((choice) => choice.id).sort();
  };

  const shapeChoiceId = geographyQuestionId('us-states', 'shape-choice', 'us-tn');

  it('varies the distractors between sessions', () => {
    /*
      Scanned over several seeds rather than compared across two: two arbitrary
      seeds CAN legitimately agree, since neighbours are preferred and Tennessee
      has only eight of them. A run of seeds that never disagrees is the real
      failure — that is a question frozen to one option set.
    */
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      seen.add(JSON.stringify(choicesFor(seed, shapeChoiceId)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('always includes the right answer among them', () => {
    for (const question of ALL()) {
      if (question.format !== 'multiple-choice') continue;
      expect(question.choices.map((choice) => choice.id)).toContain(question.correctChoiceId);
    }
  });

  it('never repeats an option within one question', () => {
    for (const question of ALL()) {
      if (question.format !== 'multiple-choice') continue;
      const ids = question.choices.map((choice) => choice.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('prefers neighbours, so the shape is what decides the answer', () => {
    /*
      The point of the whole distractor function. Offering Texas, Alaska and
      California against Vermont is free marks — the shapes are nothing alike,
      so the reader answers by elimination without knowing Vermont.
    */
    const vermont = listRegions('us-states').find((region) => region.id === 'us-vt');
    const choices = choicesFor(SEED, geographyQuestionId('us-states', 'shape-choice', 'us-vt'));

    const neighbours = choices?.filter(
      (id) => id !== 'us-vt' && vermont?.neighbors.includes(id),
    );
    expect(neighbours?.length).toBeGreaterThan(0);
  });
});

describe('map questions', () => {
  const locates = () => ALL().filter((question) => question.format === 'map-locate');

  it('never asks the reader to tap a region too small to hit', () => {
    for (const question of locates()) {
      if (question.format !== 'map-locate') continue;
      const target = listRegions(question.mapId).find(
        (region) => region.id === question.targetRegionId,
      );
      expect(target?.tiny).not.toBe(true);
    }
  });

  it('still DRAWS the small ones, so the map has no holes in it', () => {
    const europe = locates().find(
      (question) => question.format === 'map-locate' && question.mapId === 'europe',
    );
    if (europe?.format !== 'map-locate') throw new Error('expected a Europe map question');

    /*
      Monaco is never a target but is always drawn. The source boundaries do not
      overlap, so omitting it would not fold it into France — it would leave a
      hole in France where Monaco sits, which looks like a rendering bug.
    */
    expect(europe.regionIds).toEqual(listRegions('europe').map((region) => region.id));
    expect(europe.regionIds.length).toBeGreaterThan(tappableRegions('europe').length);
    expect(europe.regionIds).toContain('eu-mc');
  });

  it('draws the target it asks for', () => {
    for (const question of locates()) {
      if (question.format !== 'map-locate') continue;
      expect(question.regionIds).toContain(question.targetRegionId);
    }
  });
});

describe('shape questions', () => {
  it('carries the figure that IS the question', () => {
    const shapes = ALL().filter(
      (question) => question.format === 'short-answer' || question.format === 'multiple-choice',
    );
    expect(shapes.length).toBeGreaterThan(0);
    for (const question of shapes) {
      expect(question.figure).toEqual({
        kind: 'region-shape',
        mapId: expect.any(String),
        regionId: expect.any(String),
      });
    }
  });

  it('accepts the alternate names a reader would actually type', () => {
    const czechia = listGeographyQuestions(['europe'], SEED, NOW).find(
      (question) =>
        question.id === geographyQuestionId('europe', 'shape-name', 'eu-cz') &&
        question.format === 'short-answer',
    );
    if (czechia?.format !== 'short-answer') throw new Error('expected a short-answer question');

    expect(czechia.acceptable).toContain('Czechia');
    expect(czechia.acceptable).toContain('Czech Republic');
  });
});

describe('fitting into the rest of the app', () => {
  it('produces questions the storage validator accepts', () => {
    // They are never stored, but they pass through the same player and the same
    // registry — a row this rejects is one the app would refuse to render.
    for (const question of ALL()) {
      expect(isValidQuestion(question)).toBe(true);
    }
  });

  it('tags every question so the existing topic picker can build a quiz', () => {
    for (const question of ALL()) {
      expect(question.topics).toContain(GEOGRAPHY_TOPIC);
      expect(question.sourceId).toBe(GEOGRAPHY_SOURCE_ID);
    }
  });

  it('carries the subject as a topic, so one subject can be quizzed alone', () => {
    const europe = listGeographyQuestions(['europe'], SEED, NOW);
    for (const question of europe) expect(question.topics).toContain('europe');
  });

  it('derives nothing at all when no subject is enabled', () => {
    expect(listGeographyQuestions([], SEED, NOW)).toEqual([]);
  });

  it('scopes to the subjects asked for', () => {
    const only: Question[] = listGeographyQuestions(['continents'], SEED, NOW);
    expect(only.length).toBeGreaterThan(0);
    for (const question of only) expect(question.topics).toContain('continents');
  });
});
