// Terrain profiles from Terrarium elevation tiles (plan 4.2). Pure functions over a TileSource;
// fetching and caching live in the app (no network code in the engine).
// Zoom policy: profiles at z14 (ground resolution cos(lat)·40,075 km/(256·2^z): ≈ 7 m at 43°N);
// sampling never claims more detail than the cell size, which is returned with every profile.
// Missing tiles → "insufficient data", never a guessed result. Mosaic flags per plan 4.2.
import { LABEL_MOSAIC } from './labels.ts';
import type { SampledProfile } from './profile.ts';

export const TERRAIN_DATASET = 'aws-terrain-tiles-terrarium';
export const TILE_SIZE = 256;
export const TERRAIN_ZOOM = { profile: 14, coverage: 12, coverageFine: 13 } as const;
/** Upper bound on profile intervals; long paths get coarser spacing instead. */
export const MAX_PROFILE_INTERVALS = 20000;
const EARTH_RADIUS_M = 6371008.8; // IUGG mean radius, for path geometry on the ground
const EQUATOR_M = 40075016.686;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Terrarium: elevation (m) = R·256 + G + B/256 − 32768 (tilezen/joerd docs/formats.md). */
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Decodes RGBA pixels (row-major, 256×256) to elevations. */
export function decodeTerrariumImage(rgba: ArrayLike<number>): Float32Array {
  const n = TILE_SIZE * TILE_SIZE;
  if (rgba.length !== n * 4) throw new RangeError(`expected ${n * 4} RGBA bytes`);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = decodeTerrarium(rgba[4 * i] as number, rgba[4 * i + 1] as number, rgba[4 * i + 2] as number);
  return out;
}

export const groundResolution_m = (lat: number, z: number) => (Math.cos((lat * Math.PI) / 180) * EQUATOR_M) / (TILE_SIZE * 2 ** z);

/** Global Web Mercator pixel coordinates at zoom z (pixel (0,0) is the top-left corner of tile 0/0). */
export function lonLatToPixel(p: LatLon, z: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** z;
  const φ = (Math.max(-85.05112878, Math.min(85.05112878, p.lat)) * Math.PI) / 180;
  return {
    x: ((p.lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * size,
  };
}

export function haversine_m(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const dφ = (b.lat - a.lat) * r;
  const dλ = (b.lon - a.lon) * r;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point at fraction f along the great circle from a to b. */
export function greatCirclePoint(a: LatLon, b: LatLon, f: number): LatLon {
  const r = Math.PI / 180;
  const φ1 = a.lat * r, λ1 = a.lon * r, φ2 = b.lat * r, λ2 = b.lon * r;
  const δ = haversine_m(a, b) / EARTH_RADIUS_M;
  if (δ === 0) return { ...a };
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const zc = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(zc, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
}

export interface TileData {
  /** 256×256 elevations (m), row-major. */
  elevations: Float32Array;
  /** Source metadata if the provider sends it (Terrarium: x-amz-meta-x-imagery-sources). */
  source?: string;
}

export interface TileSource {
  getTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<TileData | null>;
}

export class TerrainError extends Error {
  readonly code: 'INSUFFICIENT_DATA' | 'COINCIDENT_TERMINALS';
  constructor(code: TerrainError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'TerrainError';
  }
}

export interface TerrainFlag {
  code: 'MOSAIC_SOURCE_BOUNDARY' | 'MOSAIC_UNKNOWN_SOURCES' | 'IMPLAUSIBLE_STEP';
  message: string;
  index?: number;
}

export interface TerrainProfile {
  profile: SampledProfile;
  dataset: string;
  zoom: number;
  /** Terrain cell size at the path's mid-latitude (m): the real horizontal resolution. */
  cellSize_m: number;
  spacing_m: number;
  length_m: number;
  tiles: string[];
  /** Individual source files named by the tiles' metadata. */
  sources: string[];
  /** Source datasets (ned13, ned, srtm, gmted, …). */
  datasets: string[];
  flags: TerrainFlag[];
}

/** Dataset family of a Terrarium source entry, e.g. "ned13/USGS_NED_13_n37w113_IMG.tif" → "ned13". */
export const sourceDataset = (s: string) => s.split('/')[0] ?? s;

/** Heuristic for implausible adjacent-sample steps (plan 4.2 mitigation 4): flagged, never silently used. */
export const STEP_CHECK = { minStep_m: 20, maxSlope: 1.0 } as const;

// Tiles are keyed by number (x·2^z + y) internally: no string building per sample (coverage speed).
const wrapX = (x: number, n: number) => ((x % n) + n) % n;
const clampY = (y: number, n: number) => Math.min(n - 1, Math.max(0, y));
const tileName = (z: number, k: number) => { const n = 2 ** z; return `${z}/${Math.floor(k / n)}/${k % n}`; };

/** Tiles needed for the 2×2 bilinear neighbourhoods of pixel positions (numeric keys). */
function tilesFor(xs: ArrayLike<number>, ys: ArrayLike<number>, z: number, needed = new Set<number>()): Set<number> {
  const n = 2 ** z;
  let last = '';
  for (let i = 0; i < xs.length; i++) {
    const fx = (xs[i] as number) - 0.5, fy = (ys[i] as number) - 0.5;
    const tx0 = Math.floor(Math.floor(fx) / TILE_SIZE), tx1 = Math.floor((Math.floor(fx) + 1) / TILE_SIZE);
    const ty0 = Math.floor(Math.floor(fy) / TILE_SIZE), ty1 = Math.floor((Math.floor(fy) + 1) / TILE_SIZE);
    const sig = tx0 === tx1 && ty0 === ty1 ? `${tx0},${ty0}` : '';
    if (sig && sig === last) continue;
    last = sig;
    for (const tx of [tx0, tx1]) for (const ty of [ty0, ty1]) needed.add(wrapX(tx, n) * n + clampY(ty, n));
  }
  return needed;
}

async function fetchTiles(src: TileSource, z: number, needed: Set<number>, signal?: AbortSignal): Promise<Map<number, TileData>> {
  const n = 2 ** z;
  const tiles = new Map<number, TileData>();
  await Promise.all([...needed].map(async (k) => {
    const t = await src.getTile(z, Math.floor(k / n), k % n, signal);
    if (!t) throw new TerrainError('INSUFFICIENT_DATA', `terrain tile ${tileName(z, k)} unavailable: insufficient data`);
    tiles.set(k, t);
  }));
  return tiles;
}

/** Bilinear elevation at a global pixel position (pixel centres at +0.5). */
function bilinear(tiles: Map<number, TileData>, z: number) {
  const n = 2 ** z;
  let lastKey = -1;
  let last: Float32Array | null = null;
  const pixel = (px: number, py: number): number => {
    const tx = Math.floor(px / TILE_SIZE), ty = clampY(Math.floor(py / TILE_SIZE), n);
    const k = wrapX(tx, n) * n + ty;
    if (k !== lastKey) { last = tiles.get(k)!.elevations; lastKey = k; }
    const lx = px - tx * TILE_SIZE, ly = Math.min(TILE_SIZE - 1, Math.max(0, py - ty * TILE_SIZE));
    return last![ly * TILE_SIZE + lx] as number;
  };
  return (x: number, y: number): number => {
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const u = fx - x0, v = fy - y0;
    return (1 - u) * (1 - v) * pixel(x0, y0) + u * (1 - v) * pixel(x0 + 1, y0) + (1 - u) * v * pixel(x0, y0 + 1) + u * v * pixel(x0 + 1, y0 + 1);
  };
}

export async function sampleProfile(src: TileSource, a: LatLon, b: LatLon, opts: { zoom?: number; spacing_m?: number; signal?: AbortSignal } = {}): Promise<TerrainProfile> {
  const z = opts.zoom ?? TERRAIN_ZOOM.profile;
  const length = haversine_m(a, b);
  if (!(length > 0)) throw new TerrainError('COINCIDENT_TERMINALS', 'the two terminals are at the same location');
  const cell = groundResolution_m((a.lat + b.lat) / 2, z);
  const spacing = Math.max(opts.spacing_m ?? cell, length / MAX_PROFILE_INTERVALS);
  const intervals = Math.max(10, Math.ceil(length / spacing));
  const xs = new Float64Array(intervals + 1), ys = new Float64Array(intervals + 1);
  for (let i = 0; i <= intervals; i++) { const p = lonLatToPixel(greatCirclePoint(a, b, i / intervals), z); xs[i] = p.x; ys[i] = p.y; }
  const tiles = await fetchTiles(src, z, tilesFor(xs, ys, z), opts.signal);
  const at = bilinear(tiles, z);
  return finishProfile(Array.from(xs, (x, i) => at(x, ys[i]!)), length, intervals, z, cell, tiles);
}

/**
 * Coverage radials (plan 6): the tiles of all radials fetched once, then each radial sampled
 * synchronously. Positions are exact great-circle points every RADIAL_CHECKPOINT samples and linear
 * in pixel space between them (test/terrain.test.ts compares with sampleProfile). Same spacing rule
 * and flags as sampleProfile.
 */
export const RADIAL_CHECKPOINT = 32;
export async function sampleRadials(
  src: TileSource, center: LatLon, ends: readonly LatLon[], opts: { zoom: number; spacing_m: number; signal?: AbortSignal },
): Promise<TerrainProfile[]> {
  const z = opts.zoom;
  const plans = ends.map((end) => {
    const length = haversine_m(center, end);
    if (!(length > 0)) throw new TerrainError('COINCIDENT_TERMINALS', 'the two terminals are at the same location');
    const spacing = Math.max(opts.spacing_m, length / MAX_PROFILE_INTERVALS);
    const intervals = Math.max(10, Math.ceil(length / spacing));
    const xs = new Float64Array(intervals + 1), ys = new Float64Array(intervals + 1);
    let prev = 0;
    let pp = lonLatToPixel(center, z);
    xs[0] = pp.x; ys[0] = pp.y;
    for (let i = Math.min(intervals, RADIAL_CHECKPOINT); ; i = Math.min(intervals, i + RADIAL_CHECKPOINT)) {
      const q = lonLatToPixel(greatCirclePoint(center, end, i / intervals), z);
      for (let k = prev + 1; k <= i; k++) { const t = (k - prev) / (i - prev); xs[k] = pp.x + t * (q.x - pp.x); ys[k] = pp.y + t * (q.y - pp.y); }
      prev = i; pp = q;
      if (i === intervals) break;
    }
    return { length, intervals, xs, ys, cell: groundResolution_m((center.lat + end.lat) / 2, z), needed: tilesFor(xs, ys, z) };
  });
  const needed = new Set<number>();
  for (const p of plans) for (const k of p.needed) needed.add(k);
  const tiles = await fetchTiles(src, z, needed, opts.signal);
  const at = bilinear(tiles, z);
  return plans.map((p) => {
    const used = new Map<number, TileData>();
    for (const k of p.needed) used.set(k, tiles.get(k)!);
    return finishProfile(Array.from(p.xs, (x, i) => at(x, p.ys[i]!)), p.length, p.intervals, z, p.cell, used);
  });
}

function finishProfile(elevations: number[], length: number, intervals: number, z: number, cell: number, tiles: Map<number, TileData>): TerrainProfile {
  // A tile's header may list several comma-separated sources ("ned13/a.tif, srtm/N41W074.tif").
  // A boundary that matters is between DATASETS (prefix before "/": ned13, ned, srtm, gmted, …),
  // which can differ in vertical datum; 1° tiles of one dataset share it.
  const flags: TerrainFlag[] = [];
  const headers = [...tiles.values()].map((t) => t.source);
  const known = [...new Set(headers.flatMap((h) => (h ? h.split(',').map((s) => s.trim()).filter(Boolean) : [])))].sort();
  const datasets = [...new Set(known.map(sourceDataset))].sort();
  if (headers.some((h) => !h)) flags.push({ code: 'MOSAIC_UNKNOWN_SOURCES', message: LABEL_MOSAIC });
  else if (datasets.length > 1) flags.push({ code: 'MOSAIC_SOURCE_BOUNDARY', message: `${LABEL_MOSAIC} (profile crosses source datasets: ${datasets.join(', ')})` });
  const step = length / intervals;
  for (let i = 1; i <= intervals; i++) {
    const d = Math.abs((elevations[i] as number) - (elevations[i - 1] as number));
    if (d > STEP_CHECK.minStep_m && d / step > STEP_CHECK.maxSlope) {
      flags.push({ code: 'IMPLAUSIBLE_STEP', index: i, message: `implausible step of ${d.toFixed(1)} m between adjacent samples at ${(i * step).toFixed(0)} m` });
    }
  }
  return {
    profile: { distances_m: Array.from({ length: intervals + 1 }, (_, i) => (i === intervals ? length : i * step)), elevations_m: elevations },
    dataset: TERRAIN_DATASET, zoom: z, cellSize_m: cell, spacing_m: step, length_m: length,
    tiles: [...tiles.keys()].map((k) => tileName(z, k)).sort(), sources: known, datasets, flags,
  };
}
