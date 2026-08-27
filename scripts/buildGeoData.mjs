// @ts-check
/**
 * Turns Natural Earth boundaries into the pre-projected SVG paths the app ships.
 *
 * DEV-ONLY. Nothing here is bundled: the app imports the committed output in
 * `src/quiz/geography/data/`, never this script. Run it again only when the map
 * detail tier changes — the borders themselves are not going to move.
 *
 *   node scripts/buildGeoData.mjs [--cache <dir>] [--offline]
 *
 * The three jobs it does, and why each is here rather than at runtime:
 *
 *  - SIMPLIFY. Full-resolution coastlines are megabytes and thousands of path
 *    nodes per region. Simplification happens on the TOPOLOGY, not on the
 *    extracted polygons, so a border shared by two states is simplified once and
 *    stays shared. Simplifying the polygons separately is the classic mistake:
 *    Tennessee and Kentucky each keep their own version of the same line, and
 *    the map develops hairline gaps along every internal border.
 *  - PROJECT. Doing it here means the runtime never needs d3-geo, and drawing a
 *    map is `<Path d={...} />` and nothing else.
 *  - MEASURE. Bounding boxes, centroids and neighbour lists are all derivable
 *    from the geometry, and all three are wanted at question-generation time
 *    where the geometry no longer exists.
 *
 * Source data is Natural Earth (public domain) via the us-atlas / world-atlas
 * TopoJSON builds (ISC). Safe to vendor.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { geoAlbersUsa, geoConicConformal, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature, merge, neighbors } from 'topojson-client';
import { presimplify, quantile, simplify } from 'topojson-simplify';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'src', 'quiz', 'geography', 'data');

const SOURCES = {
  usStates: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
  world: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
};

/**
 * The viewBox every map is projected into.
 *
 * A fixed square canvas rather than the device's aspect ratio: the component
 * scales the whole thing to fit, so the data does not need to know how tall the
 * phone is. 1000 units gives a decimal place of precision to spare at the
 * rounding below.
 */
const CANVAS = 1000;

/**
 * Coordinate precision in the emitted path strings.
 *
 * One decimal on a 1000-unit canvas is a tenth of a unit — well under a physical
 * pixel once the map is scaled down to a phone. Costs nothing visually and takes
 * roughly a third off the file size, because "412.7" is five bytes where
 * "412.68359375" is twelve.
 */
const PRECISION = 1;

/**
 * Roughly the fraction of the source points each map keeps.
 *
 * This is the "medium" tier, ~145 KB across the three files. The split between
 * them is not even, and deliberately so — it follows what each subject's
 * questions actually ask:
 *
 *  - US States and Europe are asked as SHAPES. For those questions the outline
 *    is the entire question, so they get the budget: Michigan keeps its
 *    peninsulas, Norway's fjords read as fjords, and Cape Cod survives.
 *  - Continents are only ever tapped, never identified by outline, and the tap
 *    targets are the size of a hand. Africa does not need its estuaries. They
 *    get a twentieth of the detail and still look right, which is what frees the
 *    budget for the other two.
 *
 * Raising these is safe but not free: the cost is bundle size and SVG node count
 * per frame while panning.
 */
const DETAIL = { usStates: 0.24, europe: 0.2, continents: 0.05 };

/**
 * Smallest ring worth keeping, in canvas units.
 *
 * Below about a unit on a 1000-unit canvas a ring is sub-pixel on any phone even
 * at full zoom, so it costs bytes and draws nothing. See `cleanPath`, which
 * exempts each region's largest ring from this bar.
 */
const MIN_RING_EXTENT = 1;

// ---------------------------------------------------------------------------
// The regions we actually want
// ---------------------------------------------------------------------------

/**
 * FIPS codes for the 50 states.
 *
 * DC (11) and the territories (60, 66, 69, 72, 78) are deliberately absent: the
 * subject is "US States", and a quiz that counts DC as a state is wrong in a way
 * a user will notice immediately.
 */
const US_STATE_FIPS = new Set([
  '01', '02', '04', '05', '06', '08', '09', '10', '12', '13',
  '15', '16', '17', '18', '19', '20', '21', '22', '23', '24',
  '25', '26', '27', '28', '29', '30', '31', '32', '33', '34',
  '35', '36', '37', '38', '39', '40', '41', '42', '44', '45',
  '46', '47', '48', '49', '50', '51', '53', '54', '55', '56',
]);

/** USPS abbreviations, used to build stable region ids (`us-tn`). */
const US_POSTAL = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY',
};

/**
 * European countries by ISO 3166-1 numeric code, with the id and any alternate
 * names a reader might reasonably type.
 *
 * `tiny` marks the microstates. They are kept — a shape question about San
 * Marino is perfectly fair, and excluding them from the drawn map would leave
 * visible holes in Italy and France — but the catalog never makes one a
 * TAP target, because they are a couple of pixels wide at phone scale and the
 * question would be decided by fingertip size rather than knowledge.
 *
 * Russia and Turkey are transcontinental. Both are included: the map would have
 * a conspicuous void on its eastern edge without them, and a reader asked to
 * find Russia in Europe is not being asked a trick question.
 */
const EUROPE = {
  '008': { id: 'eu-al', name: 'Albania' },
  '020': { id: 'eu-ad', name: 'Andorra', tiny: true },
  '040': { id: 'eu-at', name: 'Austria' },
  '112': { id: 'eu-by', name: 'Belarus' },
  '056': { id: 'eu-be', name: 'Belgium' },
  '070': { id: 'eu-ba', name: 'Bosnia and Herzegovina', aliases: ['Bosnia'] },
  '100': { id: 'eu-bg', name: 'Bulgaria' },
  '191': { id: 'eu-hr', name: 'Croatia' },
  '196': { id: 'eu-cy', name: 'Cyprus', tiny: true },
  '203': { id: 'eu-cz', name: 'Czechia', aliases: ['Czech Republic'] },
  '208': { id: 'eu-dk', name: 'Denmark' },
  '233': { id: 'eu-ee', name: 'Estonia' },
  '246': { id: 'eu-fi', name: 'Finland' },
  '250': { id: 'eu-fr', name: 'France' },
  '276': { id: 'eu-de', name: 'Germany' },
  '300': { id: 'eu-gr', name: 'Greece' },
  '348': { id: 'eu-hu', name: 'Hungary' },
  '352': { id: 'eu-is', name: 'Iceland' },
  '372': { id: 'eu-ie', name: 'Ireland', aliases: ['Republic of Ireland'] },
  '380': { id: 'eu-it', name: 'Italy' },
  '412': { id: 'eu-xk', name: 'Kosovo' },
  '428': { id: 'eu-lv', name: 'Latvia' },
  '438': { id: 'eu-li', name: 'Liechtenstein', tiny: true },
  '440': { id: 'eu-lt', name: 'Lithuania' },
  '442': { id: 'eu-lu', name: 'Luxembourg', tiny: true },
  '470': { id: 'eu-mt', name: 'Malta', tiny: true },
  '498': { id: 'eu-md', name: 'Moldova' },
  '492': { id: 'eu-mc', name: 'Monaco', tiny: true },
  '499': { id: 'eu-me', name: 'Montenegro' },
  '528': { id: 'eu-nl', name: 'Netherlands', aliases: ['Holland'] },
  '807': { id: 'eu-mk', name: 'North Macedonia', aliases: ['Macedonia'] },
  '578': { id: 'eu-no', name: 'Norway' },
  '616': { id: 'eu-pl', name: 'Poland' },
  '620': { id: 'eu-pt', name: 'Portugal' },
  '642': { id: 'eu-ro', name: 'Romania' },
  '643': { id: 'eu-ru', name: 'Russia', aliases: ['Russian Federation'] },
  '674': { id: 'eu-sm', name: 'San Marino', tiny: true },
  '688': { id: 'eu-rs', name: 'Serbia' },
  '703': { id: 'eu-sk', name: 'Slovakia' },
  '705': { id: 'eu-si', name: 'Slovenia' },
  '724': { id: 'eu-es', name: 'Spain' },
  '752': { id: 'eu-se', name: 'Sweden' },
  '756': { id: 'eu-ch', name: 'Switzerland' },
  '792': { id: 'eu-tr', name: 'Turkey', aliases: ['Türkiye'] },
  '804': { id: 'eu-ua', name: 'Ukraine' },
  '826': { id: 'eu-gb', name: 'United Kingdom', aliases: ['UK', 'Great Britain', 'Britain'] },
};

/**
 * ISO 3166-1 numeric codes grouped into continents.
 *
 * Continent outlines are MERGED from these rather than taken from a continent
 * file, because merging dissolves the internal borders and leaves one clean
 * coastline per continent — which is the only line a continent question is
 * about.
 *
 * Transcontinental countries are assigned whole to the continent holding most
 * of their land and population, since a merged outline cannot split one.
 */
const CONTINENTS = {
  africa: {
    name: 'Africa',
    codes: ['012','024','072','108','120','132','140','148','174','178','180','204','226','231','232','262','266','270','288','324','384','404','426','430','434','450','454','466','478','480','504','508','516','562','566','624','638','646','678','686','690','694','706','710','716','728','729','732','748','768','788','800','818','834','854','894'],
  },
  antarctica: { name: 'Antarctica', codes: ['010'] },
  asia: {
    name: 'Asia',
    codes: ['004','031','048','050','051','064','096','116','144','156','268','275','356','360','364','368','376','392','398','400','408','410','414','417','418','422','458','462','496','104','512','524','586','608','634','682','702','704','760','762','764','784','792','795','860','887','643'],
  },
  europe: { name: 'Europe', codes: Object.keys(EUROPE).filter((code) => code !== '643' && code !== '792') },
  northAmerica: {
    name: 'North America',
    codes: ['028','044','052','084','124','188','192','212','214','222','308','320','332','340','388','484','558','591','630','659','662','670','780','840','844','052'],
  },
  oceania: {
    name: 'Oceania',
    codes: ['036','090','242','296','520','540','548','554','583','584','585','598','626','776','798','882'],
  },
  southAmerica: {
    name: 'South America',
    codes: ['032','068','076','152','170','218','238','254','328','600','604','740','858','862'],
  },
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * A d3-geo path context that rounds as it writes.
 *
 * d3's default string serializer emits full float precision, which is where
 * most of the file size goes. Rounding in the context rather than with a regex
 * afterwards means the numbers are never built at full width in the first
 * place.
 */
function roundingContext() {
  let path = '';
  const round = (value) => {
    const fixed = value.toFixed(PRECISION);
    // "412.0" -> "412", and "-0" -> "0". Purely a size win.
    return fixed.replace(/\.0+$/, '').replace(/^-0$/, '0');
  };
  /*
    The last point written, so repeats can be dropped.

    Rounding MANUFACTURES duplicates: two coordinates a thousandth of a unit
    apart are one point once they are cut to a single decimal, and a simplified
    coastline is full of such pairs. Left in, they are pure bytes — an `L` to
    where the pen already is draws nothing.
  */
  let last = '';

  return {
    /** Returns what has been drawn since the last call, and starts fresh. */
    flush() {
      const result = path;
      path = '';
      last = '';
      return result;
    },
    moveTo(x, y) {
      last = `${round(x)},${round(y)}`;
      path += `M${last}`;
    },
    lineTo(x, y) {
      const point = `${round(x)},${round(y)}`;
      if (point === last) return;
      last = point;
      path += `L${point}`;
    },
    closePath() { path += 'Z'; },
    arc() { /* unused: no point features are drawn */ },
  };
}

/**
 * Drops sub-paths that simplification has collapsed to nothing.
 *
 * A coastline carries dozens of small islands, and at this detail tier most of
 * them lose every point but one — leaving `M695.4,680.2Z`, which is a ring with
 * no area. It draws nothing at any zoom level, so it is pure weight, and there
 * are enough of them to matter.
 *
 * The LARGEST ring is always kept, whatever its size. Rhode Island is genuinely
 * tiny on a 1000-unit canvas, and a threshold naive enough to measure it against
 * the same bar as a stray islet would delete the state.
 */
function cleanPath(d) {
  const rings = d.split('M').filter(Boolean).map((ring) => `M${ring}`);
  if (rings.length <= 1) return d;

  const measured = rings.map((ring) => {
    const numbers = ring.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      minX = Math.min(minX, numbers[i]);
      maxX = Math.max(maxX, numbers[i]);
      minY = Math.min(minY, numbers[i + 1]);
      maxY = Math.max(maxY, numbers[i + 1]);
    }
    // Extent rather than area: a long thin sandbar is still worth drawing.
    return { ring, extent: Math.max(maxX - minX, maxY - minY), points: numbers.length / 2 };
  });

  const largest = measured.reduce((best, ring) => (ring.extent > best.extent ? ring : best));

  return measured
    .filter((ring) => ring === largest || (ring.points >= 3 && ring.extent >= MIN_RING_EXTENT))
    .map((ring) => ring.ring)
    .join('');
}

/**
 * A projected path serializer.
 *
 * Split from `geoPath` because a `geoPath` built WITH a context returns
 * undefined from its call signature — the geometry goes to the context instead,
 * which is the whole point of passing one, but it means the path string has to
 * be collected rather than returned. `bounds` and `centroid` are unaffected:
 * they run their own streams and ignore the context entirely.
 */
function serializer(projection) {
  const context = roundingContext();
  const path = geoPath(projection, context);
  return {
    toPath(geometry) {
      path(geometry);
      return cleanPath(context.flush());
    },
    bounds: (geometry) => path.bounds(geometry),
    centroid: (geometry) => path.centroid(geometry),
  };
}

async function loadTopology(url, cacheDir, offline) {
  const name = url.split('/').pop();
  const cached = cacheDir ? join(cacheDir, name) : null;

  if (cached && existsSync(cached)) {
    return JSON.parse(readFileSync(cached, 'utf8'));
  }
  if (offline) {
    throw new Error(`--offline set but ${name} is not in the cache directory.`);
  }

  process.stdout.write(`  fetching ${name}…\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const text = await response.text();

  if (cached) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, text);
  }
  return JSON.parse(text);
}

/**
 * Simplify on the topology so shared borders stay shared.
 *
 * `quantile` turns "keep this fraction of the detail" into the weight threshold
 * `simplify` actually wants, which is the only way to express a detail tier that
 * means the same thing across two datasets of different resolutions.
 */
function simplifyTopology(topology, detail) {
  const presimplified = presimplify(topology);
  return simplify(presimplified, quantile(presimplified, detail));
}

/**
 * Whether simplification has left a region with nothing to draw.
 *
 * Simplification works on the topology as a whole, against one weight
 * threshold. That is right for coastlines and wrong for the smallest regions:
 * San Marino, Monaco, Malta, Liechtenstein and Andorra have so few points to
 * begin with that a threshold tuned for Norway deletes all of them, leaving
 * `M501.4,659.7Z` — a ring with no area.
 *
 * The consequence is not cosmetic. An invisible country is a hole in the map,
 * and a "name this country" question would show the reader an empty frame.
 */
function isDegenerate(d) {
  // No line segment means a single point; two points means a hairline.
  return !d || (d.match(/L/g)?.length ?? 0) < 2;
}

/**
 * Draws a region, dropping back to full detail when simplification has ruined
 * it.
 *
 * Cheap to do: the regions that need this are the ones with almost no points,
 * so their unsimplified geometry costs a few dozen bytes. Anything that
 * survived simplification keeps it.
 */
function drawRegion(shapes, simplifiedFeature, rawFeature) {
  const simplifiedPath = shapes.toPath(simplifiedFeature);
  if (!isDegenerate(simplifiedPath)) {
    return { d: simplifiedPath, ...measure(shapes, simplifiedFeature) };
  }
  return { d: shapes.toPath(rawFeature), ...measure(shapes, rawFeature) };
}

/** Bounding box and centroid, in projected canvas units. */
function measure(shapes, geometry) {
  const [[x0, y0], [x1, y1]] = shapes.bounds(geometry);
  const [cx, cy] = shapes.centroid(geometry);
  const round = (value) => Number(value.toFixed(PRECISION));
  return {
    bbox: [round(x0), round(y0), round(x1), round(y1)],
    // A centroid can land outside its own region (Florida, Norway). Callers use
    // it only to label and to compare distances, never to hit-test.
    centroid: [round(cx), round(cy)],
  };
}

/**
 * The lon/lat window the Europe map shows: `[west, south, east, north]`.
 *
 * Needed because a "country" in this data is its whole SOVEREIGN territory, not
 * its European part. France owns French Guiana and Réunion, Spain the Canaries,
 * Portugal the Azores, Norway Svalbard, and Russia runs to the Pacific. Fitting
 * a projection to that is what produced the first broken draft of this map:
 * everything recognisable squeezed into a corner while the fit spent its budget
 * on an island in the Indian Ocean.
 *
 * East is 50°, a little past the Urals, so European Russia is present and
 * Siberia is not. Turkey and Cyprus sit inside the southern edge.
 */
const EUROPE_WINDOW = [-25, 33, 50, 72];

/**
 * The window as a GeoJSON polygon, for fitting a projection to it.
 *
 * Two things here are easy to get wrong, and both fail loudly enough to be worth
 * naming:
 *
 *  - DENSIFIED along each edge rather than given as four corners, because under
 *    a conic projection the edges of a lon/lat rectangle are CURVES. Fitting to
 *    the corners alone underestimates the extent and lets the bowed top edge
 *    spill off the canvas.
 *  - WOUND CLOCKWISE in lon/lat. d3-geo treats rings as spherical, where a ring
 *    does not enclose a region so much as divide the sphere in two, and the
 *    winding order is the only thing saying which half you meant. Wind it the
 *    other way and this polygon means "the entire globe except this box" — which
 *    contains the projection's singularity, so the fitted scale collapses to
 *    ~0.003 and every country in Europe lands on the same pixel.
 */
/**
 * Drops the parts of a country that lie wholly outside the window.
 *
 * This is what removes Svalbard from Norway, the Azores and Madeira from
 * Portugal, the Canaries from Spain, and French Guiana and Réunion from France.
 * They survive the projected clip because the window's edges BOW under a conic
 * projection, so its bounding box reaches further than the window itself and
 * these islands land inside it — as specks scattered around the coastline. On a
 * tap-the-country map a speck is a wrong answer waiting to be hit: tapping the
 * Canaries is not knowing where Spain is.
 *
 * Whole rings only, tested by bounding box. Nothing is cut, so a ring that
 * straddles the window — Russia's landmass, which runs the full -180°..180° —
 * passes through untouched and is trimmed later by d3's own projected clip,
 * which is spherically correct where a planar cut would not be.
 */
function dropDistantRings(input, [west, south, east, north]) {
  const geometry = input.geometry;
  if (!geometry) return input;

  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];

  const kept = polygons.filter((polygon) => {
    const ring = polygon[0];
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    // Overlap, not containment: a country on the window's edge keeps the part
    // of itself that shows.
    return maxLon >= west && minLon <= east && maxLat >= south && minLat <= north;
  });

  if (kept.length === polygons.length) return input;
  return { ...input, geometry: { type: 'MultiPolygon', coordinates: kept } };
}

function windowPolygon([west, south, east, north], step = 1) {
  const ring = [];
  for (let lat = south; lat <= north; lat += step) ring.push([west, lat]);
  for (let lon = west; lon <= east; lon += step) ring.push([lon, north]);
  for (let lat = north; lat >= south; lat -= step) ring.push([east, lat]);
  for (let lon = east; lon >= west; lon -= step) ring.push([lon, south]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Adjacency, from the topology rather than from the projected shapes.
 *
 * Two regions are neighbours when they share an arc — which is exactly what
 * `topojson.neighbors` reports, and is both cheaper and more correct than
 * testing projected polygons for touching edges (Alaska and Hawaii are moved by
 * the Albers USA projection, so projected proximity there is a fiction).
 */
function neighborIds(geometries, ids) {
  const adjacency = neighbors(geometries);
  return ids.map((id, index) =>
    adjacency[index]
      .map((other) => ids[other])
      /*
        Self is filtered out because `neighbors` really does report it.

        A geometry that shares an arc with ITSELF counts as its own neighbour —
        Oregon does, via an internal arc in its multipolygon. Harmless upstream,
        but these lists exist to pick distractors, and a region is never a
        plausible wrong answer to itself.
      */
      .filter((other) => other && other !== id)
      .sort(),
  );
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * `mapId` is passed in rather than slugged from the label.
 *
 * It has to equal the matching `GeographySubject` exactly — the app looks maps
 * up by it, and the settings toggle casts it straight back to a subject. An
 * earlier version derived it from the label and silently emitted "us states"
 * with a space, which left the US map unreachable by id while still looking
 * perfectly correct in the file.
 */
function emit(filename, constName, mapId, mapName, regions, notes) {
  const rows = regions
    .map((region) => {
      const fields = [
        `id: ${JSON.stringify(region.id)}`,
        `name: ${JSON.stringify(region.name)}`,
        region.aliases?.length ? `aliases: ${JSON.stringify(region.aliases)}` : null,
        `d: ${JSON.stringify(region.d)}`,
        `bbox: [${region.bbox.join(', ')}]`,
        `centroid: [${region.centroid.join(', ')}]`,
        `neighbors: ${JSON.stringify(region.neighbors)}`,
        region.tiny ? `tiny: true` : null,
      ].filter(Boolean);
      return `  { ${fields.join(', ')} },`;
    })
    .join('\n');

  const source = `/**
 * ${mapName} boundaries. GENERATED — do not edit by hand.
 *
 * Written by \`scripts/buildGeoData.mjs\` from Natural Earth data (public
 * domain), already simplified and projected into a ${CANVAS}×${CANVAS} viewBox.
 * Re-run that script rather than editing anything here.
 *
${notes}
 */

import type { RegionMapData } from '../types';

export const ${constName}: RegionMapData = {
  id: ${JSON.stringify(mapId)},
  label: ${JSON.stringify(mapName)},
  viewBox: [0, 0, ${CANVAS}, ${CANVAS}],
  regions: [
${rows}
  ],
};
`;

  mkdirSync(OUT_DIR, { recursive: true });
  const target = join(OUT_DIR, filename);
  writeFileSync(target, source);
  const kb = (Buffer.byteLength(source) / 1024).toFixed(1);
  process.stdout.write(`  ${filename}: ${regions.length} regions, ${kb} KB\n`);
  return Buffer.byteLength(source);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildUsStates(topology) {
  const simplified = simplifyTopology(topology, DETAIL.usStates);
  const geometries = simplified.objects.states.geometries.filter((geometry) =>
    US_STATE_FIPS.has(String(geometry.id)),
  );

  const collection = feature(simplified, { type: 'GeometryCollection', geometries });
  const rawCollection = feature(topology, {
    type: 'GeometryCollection',
    geometries: topology.objects.states.geometries.filter((geometry) =>
      US_STATE_FIPS.has(String(geometry.id)),
    ),
  });
  // geoAlbersUsa lifts Alaska and Hawaii into insets, which is the only way all
  // fifty states fit one screen at a usable size.
  const projection = geoAlbersUsa().fitSize([CANVAS, CANVAS], collection);
  const shapes = serializer(projection);

  const ids = geometries.map((geometry) => {
    const postal = US_POSTAL[geometry.properties.name];
    return postal ? `us-${postal.toLowerCase()}` : null;
  });
  const adjacency = neighborIds(geometries, ids);

  const regions = collection.features.map((featureGeometry, index) => ({
    id: ids[index],
    name: featureGeometry.properties.name,
    ...drawRegion(shapes, featureGeometry, rawCollection.features[index]),
    neighbors: adjacency[index],
  }));

  return emit(
    'usStates.ts',
    'US_STATES',
    'us-states',
    'US States',
    regions,
    ' * Alaska and Hawaii sit in the projection\'s insets, so their positions on\n' +
      ' * this canvas are conventional rather than geographic. Their `neighbors`\n' +
      ' * lists are empty, which is correct and which the distractor picker relies\n' +
      ' * on falling back to similarity.',
  );
}

function buildEurope(topology) {
  const simplified = simplifyTopology(topology, DETAIL.europe);
  const inEurope = (geometry) => EUROPE[String(geometry.id).padStart(3, '0')];
  const geometries = simplified.objects.countries.geometries.filter(inEurope);

  const collection = feature(simplified, { type: 'GeometryCollection', geometries });
  /*
    The same countries at full detail, kept for the microstates.

    Both filters run over the same source array in the same order, so the two
    collections line up index for index — which is what lets `drawRegion` pick
    between them per region. See `isDegenerate`.
  */
  const rawCollection = feature(topology, {
    type: 'GeometryCollection',
    geometries: topology.objects.countries.geometries.filter(inEurope),
  });

  /*
    Conic conformal, rotated onto central Europe with parallels through the
    landmass. An equirectangular Europe is badly stretched at Nordic latitudes —
    Norway comes out roughly twice its proper width — and a shape question
    cannot survive that, because the outline IS the question.

    Fitted to the WINDOW rather than to the data, then clipped to the canvas.
    Both halves of that matter, and the first draft of this map got both wrong:

     - Fitting to the data fits to SOVEREIGN territory, which includes French
       Guiana, Réunion, the Azores, the Canaries, Svalbard and Siberia. The
       result was Europe as a thumbnail in one corner while the canvas went to
       an island in the Indian Ocean.
     - Clipping has to happen in PROJECTED space, via d3's own stream, because
       Russia's landmass ring runs from -180° to 180°. A planar clip in lon/lat
       reads the step across the antimeridian as a sweep back across the entire
       map, and turns Russia into a shape that swallows the canvas.

    d3 clips on the sphere before projecting, so it gets the antimeridian right
    and everything outside the canvas costs nothing.
  */
  const inset = [
    [CANVAS * 0.02, CANVAS * 0.02],
    [CANVAS * 0.98, CANVAS * 0.98],
  ];
  const projection = geoConicConformal().rotate([-15, 0]).parallels([40, 62]);
  projection.fitExtent(inset, windowPolygon(EUROPE_WINDOW));
  /*
    Clipped to the window's own box, not to the whole canvas.

    The difference is the outlying possessions that sit just beyond the window
    but still land on the canvas: Svalbard, the Azores, Madeira, the Canaries.
    Left in, they are specks of Norway, Portugal and Spain scattered around the
    edges — and on a tap-the-country map a speck is a wrong answer waiting to be
    hit, since tapping the Canaries is not knowing where Spain is.
  */
  projection.clipExtent(inset);
  const shapes = serializer(projection);

  const ids = geometries.map((geometry) => EUROPE[String(geometry.id).padStart(3, '0')].id);
  const adjacency = neighborIds(geometries, ids);

  const regions = collection.features.flatMap((entry, index) => {
    const meta = EUROPE[String(entry.id).padStart(3, '0')];
    const featureGeometry = dropDistantRings(entry, EUROPE_WINDOW);
    const drawn = drawRegion(
      shapes,
      featureGeometry,
      dropDistantRings(rawCollection.features[index], EUROPE_WINDOW),
    );
    const d = drawn.d;
    // A country clipped away entirely would have nothing to draw. None
    // currently are; the guard is here so that moving the window can never
    // emit a region with an empty path for the map to fail to render.
    if (!d) return [];
    return [
      {
        id: meta.id,
        name: meta.name,
        aliases: meta.aliases ?? [],
        ...drawn,
        neighbors: adjacency[index],
        tiny: meta.tiny ?? false,
      },
    ];
  });

  return emit(
    'europe.ts',
    'EUROPE',
    'europe',
    'Europe',
    regions,
    ' * Clipped to a lon/lat window, so what each country shows is its EUROPEAN\n' +
      ' * territory: no Azores, no Canaries, no Réunion, no Svalbard, and Russia\n' +
      ' * stops a little past the Urals. The straight edges where Russia and\n' +
      ' * Turkey meet the window are the clip, not a border.',
  );
}

function buildContinents(topology) {
  const simplified = simplifyTopology(topology, DETAIL.continents);
  const all = simplified.objects.countries.geometries;

  const entries = Object.entries(CONTINENTS).map(([key, { name, codes }]) => {
    const wanted = new Set(codes);
    const members = all.filter((geometry) =>
      wanted.has(String(geometry.id).padStart(3, '0')),
    );
    // merge() dissolves the shared borders, leaving one coastline per continent
    // — the only line a continent question is ever about.
    return { key, name, geometry: merge(simplified, members) };
  });

  const collection = {
    type: 'FeatureCollection',
    features: entries.map((entry) => ({
      type: 'Feature',
      id: entry.key,
      properties: { name: entry.name },
      geometry: entry.geometry,
    })),
  };

  const projection = geoNaturalEarth1().fitSize([CANVAS, CANVAS], collection);
  const shapes = serializer(projection);

  const regions = collection.features.map((featureGeometry) => ({
    id: `co-${featureGeometry.id.replace(/([A-Z])/g, '-$1').toLowerCase()}`,
    name: featureGeometry.properties.name,
    d: shapes.toPath(featureGeometry),
    ...measure(shapes, featureGeometry),
    // Continents share no borders. Left empty rather than faked, so the
    // distractor picker falls through to "any other continent" — which for a
    // seven-item set is exactly right.
    neighbors: [],
  }));

  return emit(
    'continents.ts',
    'CONTINENTS',
    'continents',
    'Continents',
    regions,
    ' * Each outline is MERGED from its member countries, so internal borders are\n' +
      ' * dissolved. Transcontinental countries are assigned whole to the continent\n' +
      ' * holding most of their land — a merged outline cannot split one.',
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const cacheIndex = args.indexOf('--cache');
  const cacheDir = cacheIndex === -1 ? join(HERE, '.geocache') : args[cacheIndex + 1];
  const offline = args.includes('--offline');

  process.stdout.write('Building geography data…\n');

  const [usTopology, worldTopology] = await Promise.all([
    loadTopology(SOURCES.usStates, cacheDir, offline),
    loadTopology(SOURCES.world, cacheDir, offline),
  ]);

  let total = 0;
  total += buildUsStates(usTopology);
  total += buildEurope(worldTopology);
  total += buildContinents(worldTopology);

  process.stdout.write(`Done — ${(total / 1024).toFixed(1)} KB total.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
