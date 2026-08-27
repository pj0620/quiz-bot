/**
 * Geography: the app's first material that is DERIVED rather than stored.
 *
 * Notes and vocabulary are both unpredictable — nobody can enumerate in advance
 * what a note will ask — so both are generated once by a model and kept as rows
 * in the bank. The fifty states are not like that. They are a fixed, known set
 * that is not going to change, and paying a model to write "which state is this
 * outline?" fifty times, storing the results, then re-reading them forever is
 * the wrong shape for material a function can produce on demand.
 *
 * So a geography question is never written to the bank. It is derived at
 * session start from the data in `./data`, and derived AGAIN — identically —
 * whenever a session is resumed. Two properties make that safe, and everything
 * else in this folder exists to protect them:
 *
 *  - IDENTITY IS STABLE. A question's id is hashed from subject + kind +
 *    region, so it is the same id today, tomorrow, and after a reinstall. That
 *    is what lets review state accumulate: "you keep missing Vermont" is a fact
 *    about a question id, and an id that changed per session could never carry
 *    it.
 *  - CONTENT VARIES BY SEED. The distractors on a multiple-choice question are
 *    drawn from the session seed, so the options differ between runs while the
 *    id stays put. This is the same split `MultipleChoiceView` already uses when
 *    it reshuffles choices with `shuffleSeed` — identity in the id, presentation
 *    from the seed.
 *
 * The second property is why `Session.seed` matters more here than anywhere
 * else in the app: it is persisted, so a resumed session regenerates the same
 * options it was showing before, and a stored grade still lines up with the
 * question it graded.
 */

// ---------------------------------------------------------------------------
// Map data
// ---------------------------------------------------------------------------

/** A projected bounding box: `[minX, minY, maxX, maxY]` in canvas units. */
export type BBox = [number, number, number, number];

export type Point = [number, number];

/**
 * One drawable, nameable area — a state, a country, a continent.
 *
 * Everything here is precomputed by `scripts/buildGeoData.mjs`. Nothing at
 * runtime knows what a latitude is: `d` is already projected into the map's
 * viewBox, so drawing is `<Path d={region.d} />` and nothing more.
 */
export type Region = {
  /** Stable and namespaced by map: `us-tn`, `eu-fr`, `co-africa`. */
  id: string;
  name: string;
  /**
   * Other names a reader might reasonably type. Feeds the `acceptable` list on
   * short-answer questions, so "Czech Republic" and "Holland" both pass without
   * any new grading code.
   */
  aliases?: string[];
  /** Pre-projected SVG path data, in the parent map's viewBox units. */
  d: string;
  bbox: BBox;
  /**
   * Label anchor. May fall OUTSIDE its own region for concave shapes (Florida,
   * Norway), so it is used for labelling and distance comparison only, never to
   * decide what was tapped.
   */
  centroid: Point;
  /** Regions sharing a border. Empty for islands and continents. */
  neighbors: string[];
  /**
   * Too small to be a fair tap target at phone scale.
   *
   * Still drawn, and still fair game for shape and naming questions — the flag
   * only keeps the region from being the ANSWER to "tap this on the map", where
   * success would come down to fingertip size rather than knowledge.
   */
  tiny?: boolean;
};

export type RegionMapData = {
  id: string;
  label: string;
  /** `[minX, minY, width, height]` — the canvas every `d` is drawn in. */
  viewBox: [number, number, number, number];
  regions: Region[];
};

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/**
 * The three subjects, which are also the map ids and the topic slugs.
 *
 * One identifier doing all three jobs is deliberate: it means a quiz rule
 * filtering on the topic `us-states` and a question pointing at the map
 * `us-states` cannot drift apart.
 */
export const GEOGRAPHY_SUBJECTS = ['us-states', 'europe', 'continents'] as const;

export type GeographySubject = (typeof GEOGRAPHY_SUBJECTS)[number];

export function isGeographySubject(value: unknown): value is GeographySubject {
  return (
    typeof value === 'string' &&
    (GEOGRAPHY_SUBJECTS as readonly string[]).includes(value)
  );
}

/**
 * The reserved source id every derived question carries.
 *
 * Follows the precedent set out at length in `src/quiz/vocab/types.ts`: every
 * question needs a `sourceId`, real ones are namespaced (`github-repo:42`), so
 * a bare `geography` cannot collide, and reusing the field beats adding a second
 * discriminator that would leave `sourceId` still needing a value.
 *
 * It also earns its keep in one specific place: `removeQuestionsForSource` and
 * the bank browser's source filter both work on it unchanged.
 */
export const GEOGRAPHY_SOURCE_ID = 'geography';

/**
 * The topic every geography question carries, alongside its subject.
 *
 * Fixed rather than model-chosen, for the reason `generation/noteTopics.ts`
 * gives: a model asked to name topics drifts between synonyms and re-fragments
 * the vocabulary within a few runs. Being a constant is also what makes a
 * "Geography" quiz buildable through the EXISTING topic picker, with no new
 * quiz machinery at all.
 */
export const GEOGRAPHY_TOPIC = 'geography';

export type MapId = GeographySubject;

/**
 * What a question asks the reader to do. Part of the question id, so adding a
 * kind creates new questions rather than mutating existing ones.
 */
export const GEOGRAPHY_KINDS = ['locate', 'shape-choice', 'shape-name'] as const;

export type GeographyKind = (typeof GEOGRAPHY_KINDS)[number];
