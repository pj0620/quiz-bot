import { CONTINENTS } from './data/continents';
import { EUROPE } from './data/europe';
import { US_STATES } from './data/usStates';
import { GEOGRAPHY_SUBJECTS, type GeographySubject, type MapId, type Region, type RegionMapData } from './types';

/**
 * The map registry — the single place the generated data is reachable from.
 *
 * Mapped over `GeographySubject` in the same way `questionTypes/registry.ts` is
 * mapped over `QuestionFormat`, and for the same reason: adding a subject
 * without adding its data is then a COMPILE error rather than an empty map
 * discovered at runtime.
 *
 * Lookups are indexed on first use rather than at module load. These tables are
 * ~130 KB of path strings that most sessions never touch — geography is opt-in,
 * and a reader who has not enabled it should not pay to index three maps on
 * every cold start.
 */
const MAPS: { [K in GeographySubject]: RegionMapData } = {
  'us-states': US_STATES,
  europe: EUROPE,
  continents: CONTINENTS,
};

/** Region id -> region, per map. Built once, on first lookup. */
const indexes = new Map<MapId, Map<string, Region>>();

function indexFor(mapId: MapId): Map<string, Region> {
  const existing = indexes.get(mapId);
  if (existing) return existing;

  const index = new Map(MAPS[mapId].regions.map((region) => [region.id, region]));
  indexes.set(mapId, index);
  return index;
}

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && value in MAPS;
}

/** Undefined rather than throwing: callers are validators and renderers. */
export function getRegionMap(mapId: string): RegionMapData | undefined {
  return isMapId(mapId) ? MAPS[mapId] : undefined;
}

export function getRegion(mapId: string, regionId: string): Region | undefined {
  return isMapId(mapId) ? indexFor(mapId).get(regionId) : undefined;
}

export function listRegions(mapId: MapId): Region[] {
  return MAPS[mapId].regions;
}

/**
 * The regions eligible to be the ANSWER to a "tap this" question.
 *
 * Excludes the microstates. Monaco is about two canvas units across; at any
 * zoom level a phone can show, finding it is a test of fingertip precision
 * rather than of knowing where it is. They stay on the map — a Europe with
 * holes in it would look broken, and they remain fair game as shapes and names.
 */
export function tappableRegions(mapId: MapId): Region[] {
  return MAPS[mapId].regions.filter((region) => !region.tiny);
}

export function listMaps(): RegionMapData[] {
  return GEOGRAPHY_SUBJECTS.map((subject) => MAPS[subject]);
}
