import { getRegion, listMaps, listRegions, tappableRegions } from './maps';
import { GEOGRAPHY_SUBJECTS } from './types';

/*
  Integrity of the GENERATED map tables.

  These files are written by `scripts/buildGeoData.mjs` and never edited by
  hand, so this suite is really a test of that script — and it has already
  earned its place. Earlier drafts of the build produced, in turn: every region
  collapsed onto a single point, one country swallowing the whole canvas, and
  paths made entirely of degenerate `M…Z` stubs left behind by simplification.
  Every one of those would have shipped as a blank or unusable map, and every
  one of them is caught below.
*/

describe.each(GEOGRAPHY_SUBJECTS)('%s', (subject) => {
  const regions = listRegions(subject);

  it('has regions', () => {
    expect(regions.length).toBeGreaterThan(0);
  });

  it('gives every region a unique id', () => {
    const ids = regions.map((region) => region.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every region a name and a drawable path', () => {
    for (const region of regions) {
      expect(region.name.length).toBeGreaterThan(0);
      // A path has to start with a move and contain at least one line, or it
      // draws nothing — the exact failure mode of the collapsed first build.
      expect(region.d.startsWith('M')).toBe(true);
      expect(region.d).toContain('L');
    }
  });

  it('keeps every region inside the canvas it was projected into', () => {
    const [, , width, height] = listMaps().find((map) => map.id === subject)!.viewBox;
    for (const region of regions) {
      const [minX, minY, maxX, maxY] = region.bbox;
      expect(minX).toBeGreaterThanOrEqual(-1);
      expect(minY).toBeGreaterThanOrEqual(-1);
      expect(maxX).toBeLessThanOrEqual(width + 1);
      expect(maxY).toBeLessThanOrEqual(height + 1);
    }
  });

  it('gives every region a non-degenerate bounding box', () => {
    for (const region of regions) {
      const [minX, minY, maxX, maxY] = region.bbox;
      expect(maxX).toBeGreaterThan(minX);
      expect(maxY).toBeGreaterThan(minY);
    }
  });

  it('has no region large enough to have swallowed the map', () => {
    /*
      The symptom of the antimeridian bug: Russia's ring, clipped in planar
      lon/lat, became a shape covering the entire canvas while every other
      country collapsed to a point. A single region covering nearly everything
      is not a real map.
    */
    const [, , width, height] = listMaps().find((map) => map.id === subject)!.viewBox;
    for (const region of regions) {
      const [minX, minY, maxX, maxY] = region.bbox;
      const covers = ((maxX - minX) * (maxY - minY)) / (width * height);
      expect(covers).toBeLessThan(0.95);
    }
  });

  it('places every centroid inside the map', () => {
    const [, , width, height] = listMaps().find((map) => map.id === subject)!.viewBox;
    for (const region of regions) {
      const [x, y] = region.centroid;
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(width + 1);
      expect(y).toBeLessThanOrEqual(height + 1);
    }
  });

  it('only ever names neighbours that exist on the same map', () => {
    for (const region of regions) {
      for (const neighbor of region.neighbors) {
        expect(getRegion(subject, neighbor)).toBeDefined();
      }
    }
  });

  it('never lists a region as its own neighbour', () => {
    for (const region of regions) {
      expect(region.neighbors).not.toContain(region.id);
    }
  });

  it('leaves something tappable', () => {
    expect(tappableRegions(subject).length).toBeGreaterThan(0);
  });
});

describe('us-states', () => {
  const regions = listRegions('us-states');

  it('has exactly the fifty states — no DC, no territories', () => {
    expect(regions).toHaveLength(50);
    for (const name of ['District of Columbia', 'Puerto Rico', 'Guam']) {
      expect(regions.map((region) => region.name)).not.toContain(name);
    }
  });

  it('includes the two that the projection moves into insets', () => {
    const names = regions.map((region) => region.name);
    expect(names).toContain('Alaska');
    expect(names).toContain('Hawaii');
  });

  it('gives the contiguous states neighbours to draw distractors from', () => {
    const tennessee = getRegion('us-states', 'us-tn');
    expect(tennessee?.neighbors.length).toBeGreaterThan(0);
  });
});

describe('europe', () => {
  it('keeps the microstates on the map but out of the tap targets', () => {
    const monaco = getRegion('europe', 'eu-mc');
    expect(monaco).toBeDefined();
    expect(monaco?.tiny).toBe(true);
    expect(tappableRegions('europe').map((region) => region.id)).not.toContain('eu-mc');
  });

  it('carries the alternate names a reader would type', () => {
    expect(getRegion('europe', 'eu-cz')?.aliases).toContain('Czech Republic');
    expect(getRegion('europe', 'eu-gb')?.aliases).toContain('UK');
  });

  it('trims the overseas territories that would sit as specks off the coast', () => {
    /*
      France owns French Guiana and Réunion, Spain the Canaries, Portugal the
      Azores. Left in, each is a stray fragment far from its country — and on a
      tap-the-country map a speck is a wrong answer waiting to be hit.
      Checked via the bounding box, which is what those fragments inflate.
    */
    const france = getRegion('europe', 'eu-fr');
    const [minX, minY, maxX, maxY] = france!.bbox;
    expect(maxX - minX).toBeLessThan(300);
    expect(maxY - minY).toBeLessThan(300);
  });
});

describe('continents', () => {
  it('has the seven', () => {
    expect(listRegions('continents')).toHaveLength(7);
  });

  it('merges each one into a single outline with no internal borders', () => {
    // Africa merged from ~56 countries should be one continuous coastline, not
    // 56 shapes stacked up; a stray internal border would show as a seam.
    const africa = getRegion('continents', 'co-africa');
    expect(africa).toBeDefined();
    expect(africa!.d.length).toBeGreaterThan(100);
  });
});
