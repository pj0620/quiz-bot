import { hashString, seededShuffle } from '../../lib/random';
import type { Difficulty, Question } from '../types';
import { listRegions } from './maps';
import {
  GEOGRAPHY_KINDS,
  GEOGRAPHY_SOURCE_ID,
  GEOGRAPHY_TOPIC,
  type GeographyKind,
  type GeographySubject,
  type MapId,
  type Region,
} from './types';

/**
 * Derives geography questions from the map tables.
 *
 * This is the whole procedural half of the feature. Nothing here is stored:
 * `listGeographyQuestions` is called at session start, and called again with
 * the same seed whenever a session is resumed, and both times it produces the
 * same questions. See `./types.ts` for why the material is derived rather than
 * generated and saved.
 *
 * The one rule to keep in mind when changing anything below:
 *
 *   The QUESTION ID may depend only on subject, kind and region.
 *   Everything else may depend on the seed.
 *
 * Break the first half and every stored review state is orphaned — the reader
 * loses their entire geography history silently, because nothing errors, the
 * ids simply stop matching. Break the second half and the same four options
 * come up every single time.
 */

/** How many options a shape-recognition question offers. */
const CHOICE_COUNT = 4;

/**
 * `intro` for continents, `core` for the rest.
 *
 * Naming the seven continents is genuinely easier than placing Vermont, and
 * difficulty feeds quiz rules — a reader who has filtered to `intro` should get
 * the continents, not a Balkan border quiz.
 */
const SUBJECT_DIFFICULTY: Record<GeographySubject, Difficulty> = {
  'us-states': 'core',
  europe: 'core',
  continents: 'intro',
};

const SUBJECT_NOUN: Record<GeographySubject, string> = {
  'us-states': 'state',
  europe: 'country',
  continents: 'continent',
};

/**
 * A question's permanent identity.
 *
 * Deliberately NOT hashed with anything seed-derived. This is the string that
 * makes "you keep missing Vermont" a durable fact rather than a coincidence
 * within one session.
 */
export function geographyQuestionId(
  subject: GeographySubject,
  kind: GeographyKind,
  regionId: string,
): string {
  return `geo-${hashString(`geography:${subject}:${kind}:${regionId}`).toString(36)}`;
}

/** Everything a derived question shares. Kept in one place so ids and topics can't drift. */
function base(input: {
  subject: GeographySubject;
  kind: GeographyKind;
  region: Region;
  prompt: string;
  explanation: string;
  now: number;
}) {
  const { subject, kind, region, prompt, explanation, now } = input;
  return {
    id: geographyQuestionId(subject, kind, region.id),
    prompt,
    explanation,
    // Two topics, both fixed: the general one builds a Geography quiz, the
    // specific one builds a US States quiz. Neither is ever model-chosen.
    topics: [GEOGRAPHY_TOPIC, subject],
    difficulty: SUBJECT_DIFFICULTY[subject],
    sourceId: GEOGRAPHY_SOURCE_ID,
    /*
      `path` namespaces the region the same way vocab namespaces a word, which
      is what lets anything holding only a question work out what it was about.
      There is no file behind it and no revision to record.
    */
    provenance: { sourceId: GEOGRAPHY_SOURCE_ID, path: `${subject}/${region.id}` },
    addedAt: now,
  };
}

/**
 * Distractors that make the question worth asking.
 *
 * A Vermont question offering Texas, Alaska and California is free marks: the
 * shapes are nothing alike and the reader can answer by elimination without
 * knowing Vermont. Neighbours are the hard, useful wrong answers, so they come
 * first — telling Vermont from New Hampshire is the thing actually being
 * tested.
 *
 * Falls through to similarly-SIZED regions once neighbours run out, which
 * matters more than it sounds: Alaska and Hawaii have no neighbours at all in
 * the projected data, and continents have none by nature. Size keeps those
 * questions from filling up with obviously-wrong giants.
 *
 * Seeded, so the same question offers a different set next time.
 */
function distractorsFor(region: Region, pool: readonly Region[], seed: number): Region[] {
  const others = pool.filter((candidate) => candidate.id !== region.id);
  const neighbors = new Set(region.neighbors);

  const adjacent = others.filter((candidate) => neighbors.has(candidate.id));
  const rest = others.filter((candidate) => !neighbors.has(candidate.id));

  const extent = (value: Region) =>
    Math.max(value.bbox[2] - value.bbox[0], value.bbox[3] - value.bbox[1]);
  const target = extent(region);

  // Shuffled BEFORE the sort so that equally-similar regions don't always come
  // back in table order — a stable sort would otherwise pin the same runner-up
  // to every seed.
  const bySimilarity = seededShuffle(rest, seed).sort(
    (a, b) => Math.abs(extent(a) - target) - Math.abs(extent(b) - target),
  );

  return [...seededShuffle(adjacent, seed), ...bySimilarity].slice(0, CHOICE_COUNT - 1);
}

/**
 * Every question for one subject.
 *
 * Three per region — find it on the map, name its outline from options, name
 * its outline unaided — minus the map questions for regions too small to tap.
 */
function questionsForSubject(
  subject: GeographySubject,
  seed: number,
  now: number,
): Question[] {
  const regions = listRegions(subject);
  /*
    DRAWN is every region; TARGET is only the ones big enough to hit.

    Monaco, San Marino, Liechtenstein and Andorra are enclaves, and the source
    boundaries do not overlap — so leaving them out would not merge them into
    France or Italy, it would cut visible holes in them. They are drawn, and
    tapping one is simply a wrong answer, which is fair. What they never are is
    the thing being asked for.
  */
  const drawnIds = regions.map((region) => region.id);
  const noun = SUBJECT_NOUN[subject];
  const questions: Question[] = [];

  for (const region of regions) {
    // A question asking for Monaco would be decided by fingertip size rather
    // than by knowing where Monaco is.
    if (!region.tiny) {
      questions.push({
        ...base({
          subject,
          kind: 'locate',
          region,
          prompt: `Tap ${region.name} on the map.`,
          explanation: `${region.name} is highlighted once you answer.`,
          now,
        }),
        format: 'map-locate',
        mapId: subject,
        targetRegionId: region.id,
        regionIds: drawnIds,
      });
    }

    // Seeded per QUESTION, not per batch, so adding a subject or reordering the
    // loop cannot shift the options of an unrelated question.
    const choiceSeed = hashString(`${subject}:${region.id}:choice`) ^ seed;
    const options = [region, ...distractorsFor(region, regions, choiceSeed)];

    /*
      Only worth asking when there are enough regions to fill the options. A
      two-option "multiple choice" is a true/false question wearing a costume,
      and the reader deserves the real thing or nothing.
    */
    if (options.length === CHOICE_COUNT) {
      questions.push({
        ...base({
          subject,
          kind: 'shape-choice',
          region,
          prompt: `Which ${noun} is this?`,
          explanation: `This is ${region.name}.`,
          now,
        }),
        format: 'multiple-choice',
        // NOT shuffled here: `MultipleChoiceView` shuffles at render from the
        // question id and the session seed, so the correct answer may always be
        // emitted first without leaking it.
        choices: options.map((option) => ({ id: option.id, text: option.name })),
        correctChoiceId: region.id,
        figure: { kind: 'region-shape', mapId: subject, regionId: region.id },
      });
    }

    questions.push({
      ...base({
        subject,
        kind: 'shape-name',
        region,
        prompt: `Name this ${noun}.`,
        explanation: `This is ${region.name}.`,
        now,
      }),
      format: 'short-answer',
      modelAnswer: region.name,
      // Rides the EXISTING short-answer field, so "Czechia", "Czech Republic"
      // and "Holland" all pass with no new grading code. A miss here falls
      // through to self-grading rather than being marked wrong.
      acceptable: [region.name, ...(region.aliases ?? [])],
      figure: { kind: 'region-shape', mapId: subject, regionId: region.id },
    });
  }

  return questions;
}

/**
 * The derived bank for the enabled subjects.
 *
 * `seed` should be the session's own seed, which is persisted — that is what
 * makes a resumed session regenerate the same options it was showing before.
 */
export function listGeographyQuestions(
  subjects: readonly GeographySubject[],
  seed: number,
  now = Date.now(),
): Question[] {
  const questions: Question[] = [];
  for (const subject of subjects) {
    questions.push(...questionsForSubject(subject, seed, now));
  }
  return questions;
}

/** Whether a question came from here. Cheap enough to call per row. */
export function isGeographyQuestion(question: Question): boolean {
  return question.sourceId === GEOGRAPHY_SOURCE_ID;
}

/**
 * The place a question is about, if it is about a place at all.
 *
 * Read off the QUESTION rather than off its `sourceId`, which is what makes it
 * usable by the screens: they need the map and the region, and asking "is this
 * geography?" would only tell them to go looking for both somewhere else.
 *
 * The two shapes it recognises are the two the catalog emits — a map question
 * names its target directly, a shape question carries it as a figure. Anything
 * else is not about a place, which includes every question ever written from a
 * note.
 */
export function geographyLocationOf(
  question: Question,
): { mapId: MapId; regionId: string } | null {
  if (question.format === 'map-locate') {
    return { mapId: question.mapId, regionId: question.targetRegionId };
  }
  if (question.figure?.kind === 'region-shape') {
    return { mapId: question.figure.mapId, regionId: question.figure.regionId };
  }
  return null;
}

export { GEOGRAPHY_KINDS };
