import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE, TerrainError, decodeTerrarium, decodeTerrariumImage, greatCirclePoint, groundResolution_m,
  haversine_m, lonLatToPixel, sampleProfile, type TileData, type TileSource,
} from '../src/terrain.ts';

/** Synthetic world: elevation as a function of global pixel coordinates at zoom z. */
function world(fn: (gx: number, gy: number) => number, source?: (x: number, y: number) => string | undefined): TileSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getTile(z, x, y) {
      calls.push(`${z}/${x}/${y}`);
      const e = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) e[j * TILE_SIZE + i] = fn(x * TILE_SIZE + i + 0.5, y * TILE_SIZE + j + 0.5);
      const t: TileData = { elevations: e };
      const s = source?.(x, y);
      if (s) t.source = s;
      return t;
    },
  };
}

describe('terrain (plan 4.2)', () => {
  it('Terrarium decoding', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).fill(128);
    expect(decodeTerrariumImage(rgba)[0]).toBe(128 * 256 + 128 + 0.5 - 32768);
  });

  it('ground resolution matches the plan figures at 43°N', () => {
    expect(groundResolution_m(43, 14)).toBeCloseTo(6.99, 1);
    expect(groundResolution_m(43, 13)).toBeCloseTo(13.98, 1);
    expect(groundResolution_m(43, 12)).toBeCloseTo(27.96, 1);
  });

  it('tile math: z14 tile x=3089 y=6430 contains Mather Point, Grand Canyon (36.0617N 112.1081W)', () => {
    const p = lonLatToPixel({ lat: 36.0617, lon: -112.1081 }, 14);
    expect(Math.floor(p.x / 256)).toBe(3089);
    expect(Math.floor(p.y / 256)).toBe(6430);
  });

  it('great circle geometry', () => {
    const a = { lat: 36.0617, lon: -112.1081 }, b = { lat: 36.0441, lon: -111.826 };
    const m = greatCirclePoint(a, b, 0.5);
    expect(haversine_m(a, m)).toBeCloseTo(haversine_m(a, b) / 2, 3);
  });

  it('bilinear sampling of a linear surface is exact; uniform distances; cell size reported', async () => {
    const z = 14;
    const a = { lat: 39.1, lon: -96.6 }, b = { lat: 39.12, lon: -96.55 };
    const pa = lonLatToPixel(a, z), pb = lonLatToPixel(b, z);
    // small values around the path so the float32 tile storage is not the limiting precision
    const surf = (gx: number, gy: number) => 100 + 0.05 * (gx - pa.x) - 0.02 * (gy - pa.y);
    const t = await sampleProfile(world(surf), a, b, { zoom: z });
    expect(t.profile.elevations_m[0]).toBeCloseTo(surf(pa.x, pa.y), 4);
    expect(t.profile.elevations_m.at(-1)).toBeCloseTo(surf(pb.x, pb.y), 4);
    expect(t.cellSize_m).toBeCloseTo(groundResolution_m(39.11, 14), 9);
    const d = t.profile.distances_m;
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(t.length_m);
    expect(t.flags.map((f) => f.code)).toContain('MOSAIC_UNKNOWN_SOURCES');
  });

  it('missing tile → insufficient data (never a guessed result)', async () => {
    const src: TileSource = { getTile: async (_z, x) => (x % 2 ? null : { elevations: new Float32Array(TILE_SIZE * TILE_SIZE) }) };
    await expect(sampleProfile(src, { lat: 39.1, lon: -96.6 }, { lat: 39.1, lon: -96.5 })).rejects.toMatchObject({ code: 'INSUFFICIENT_DATA' });
  });

  it('coincident terminals are rejected', async () => {
    await expect(sampleProfile(world(() => 0), { lat: 1, lon: 1 }, { lat: 1, lon: 1 })).rejects.toBeInstanceOf(TerrainError);
  });

  it('mosaic: crossing a source boundary is flagged; a single known source is not', async () => {
    const a = { lat: 39.1, lon: -96.6 }, b = { lat: 39.1, lon: -96.5 };
    const split = await sampleProfile(world(() => 50, (x) => (x < 3798 ? 'ned13/A' : 'srtm/B')), a, b);
    expect(split.flags.map((f) => f.code)).toContain('MOSAIC_SOURCE_BOUNDARY');
    const single = await sampleProfile(world(() => 50, (x) => (x < 3798 ? 'ned13/A' : 'ned13/C, ned13/A')), a, b);
    expect(single.flags.filter((f) => f.code.startsWith('MOSAIC'))).toEqual([]); // two 1° tiles, one dataset
    expect(single.sources).toEqual(['ned13/A', 'ned13/C']);
    const mixedTile = await sampleProfile(world(() => 50, () => 'ned13/A, srtm/N41W074.tif'), a, b);
    expect(mixedTile.flags.map((f) => f.code)).toContain('MOSAIC_SOURCE_BOUNDARY');
    expect(mixedTile.datasets).toEqual(['ned13', 'srtm']);
  });

  it('implausible adjacent steps are flagged', async () => {
    const t = await sampleProfile(world((gx) => (gx > 3798.5 * 256 ? 500 : 0)), { lat: 39.1, lon: -96.6 }, { lat: 39.1, lon: -96.5 });
    expect(t.flags.some((f) => f.code === 'IMPLAUSIBLE_STEP')).toBe(true);
  });
});
