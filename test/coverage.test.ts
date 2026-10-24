import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { predictPathLoss } from '../src/path.ts';
import { defaultTerminalClutter, type ClutterTypeName } from '../src/environment.ts';
import { haversine_m } from '../src/terrain.ts';
import {
  CLUTTER_INDEX, CLUTTER_UNKNOWN, COVERAGE_FLAG, coverageResolution, destinationPoint, radialPrefixLosses,
  robustPointSet, uncertaintySamples, type RadialRequest,
} from '../src/coverage.ts';
import { handle } from '../src/worker.ts';
import { bearing_deg } from '../src/antenna.ts';
import { request, synth } from './helpers.ts';

let wasm: EngineWasm;
beforeAll(async () => { wasm = await loadEngineWasm(); });

const ridge = synth(30000, 1500, (x) => 120 + 80 * Math.exp(-(((x - 0.35) / 0.05) ** 2)) + 30 * Math.sin(x * 40));
const column = { time: 50, location: 50, situation: 50 };

function radial(over: Partial<RadialRequest> = {}): RadialRequest {
  const base = request(ridge);
  return {
    elevations_m: ridge.elevations_m, spacing_m: ridge.spacing_m, every: 5,
    f_mhz: base.f_mhz, climate: base.climate, N_0: base.N_0, polarization: base.polarization, ground: base.ground,
    variability: { mode: base.variability.mode, column },
    tx: { height_m: 10, clutter: null }, rx: { height_m: 1.5, clutter: null },
    ...over,
  };
}

describe('radial prefix coverage (plan 6)', () => {
  it('each point equals the point-to-point result on the truncated profile (Option A)', () => {
    const r = radialPrefixLosses(wasm, radial());
    expect(r.loss_db.length).toBe(300);
    for (const j of [1, 7, 60, 150, 299]) {
      const k = (j + 1) * 5;
      const p2p = predictPathLoss(wasm, request({ spacing_m: ridge.spacing_m, elevations_m: ridge.elevations_m.slice(0, k + 1) }, {
        heights: { a_m: 10, b_m: 1.5 }, variability: { mode: 13, columns: [column] },
      }));
      expect(r.distance_m[j]).toBeCloseTo(k * ridge.spacing_m, 9);
      expect(r.loss_db[j]).toBeCloseTo(p2p.columns[0]!.totalLoss_db, 4); // float32 storage
      expect(r.txAngle_rad[j]).toBeCloseTo(p2p.angles!.a_rad, 6);
      expect(r.rxAngle_rad[j]).toBeCloseTo(p2p.angles!.b_rad, 6);
      expect(!!(r.flags[j]! & COVERAGE_FLAG.LINE_OF_SIGHT)).toBe(p2p.angles!.geometricLineOfSight);
    }
  });

  it('Option B: receiver clutter per point, same as point-to-point with that terminal type', () => {
    const types: ClutterTypeName[] = ['suburban', 'open-rural', 'trees-forest'];
    const byType = Object.fromEntries(types.map((t) => [t, defaultTerminalClutter(t)]));
    const perPoint = Uint8Array.from({ length: 300 }, (_, j) => CLUTTER_INDEX.indexOf(types[j % 3]!));
    const tx = defaultTerminalClutter('suburban');
    const r = radialPrefixLosses(wasm, radial({ tx: { height_m: 4, clutter: tx }, rx: { height_m: 1.5, clutter: { byType, perPoint, fallback: 'suburban' } } }));
    for (const j of [30, 31, 32, 200]) {
      const k = (j + 1) * 5;
      const p2p = predictPathLoss(wasm, request({ spacing_m: ridge.spacing_m, elevations_m: ridge.elevations_m.slice(0, k + 1) }, {
        heights: { a_m: 4, b_m: 1.5 }, variability: { mode: 13, columns: [column] },
        environment: { option: 'B', a: tx, b: byType[types[j % 3]!]! },
      }));
      expect(r.loss_db[j]).toBeCloseTo(p2p.columns[0]!.totalLoss_db, 4);
    }
  });

  it('unknown receiver clutter uses the fallback and is flagged', () => {
    const perPoint = new Uint8Array(300).fill(CLUTTER_UNKNOWN);
    const r = radialPrefixLosses(wasm, radial({ rx: { height_m: 1.5, clutter: { byType: { suburban: defaultTerminalClutter('suburban') }, perPoint, fallback: 'suburban' } } }));
    expect(r.flags.every((f) => (f & COVERAGE_FLAG.CLUTTER_FALLBACK) !== 0)).toBe(true);
    expect(Number.isFinite(r.loss_db[100]!)).toBe(true);
  });

  it('points under 1 km are flagged extrapolated; short prefixes are resampled to the wrapper minimum', () => {
    const r = radialPrefixLosses(wasm, radial({ every: 1 }));
    expect(r.flags[0]! & COVERAGE_FLAG.EXTRAPOLATED).toBeTruthy(); // 20 m
    expect(Number.isFinite(r.loss_db[0]!)).toBe(true);
    const at1km = Array.from(r.distance_m).findIndex((d) => d >= 1000);
    expect(r.flags[at1km]! & COVERAGE_FLAG.EXTRAPOLATED).toBeFalsy();
  });

  it('error-zone inputs give no value (unsupported), never a guessed one', () => {
    const r = radialPrefixLosses(wasm, radial({ N_0: 200 }));
    expect(r.loss_db.every((v) => Number.isNaN(v))).toBe(true);
    expect(r.flags.every((f) => (f & COVERAGE_FLAG.UNSUPPORTED) !== 0)).toBe(true);
    expect(r.issues).toContain('REFRACTIVITY');
  });

  it('angles: false gives the same losses without pointing angles', () => {
    const a = radialPrefixLosses(wasm, radial());
    const b = radialPrefixLosses(wasm, radial({ angles: false }));
    expect(Array.from(b.loss_db)).toEqual(Array.from(a.loss_db));
    expect(Number.isNaN(b.txAngle_rad[50]!)).toBe(true);
    expect(b.flags[50]! & COVERAGE_FLAG.LINE_OF_SIGHT).toBe(0);
  });

  it('runs as a worker task', async () => {
    const rep = await handle({ id: 1, type: 'coverageRadial', payload: radial() });
    expect(rep.ok).toBe(true);
  });
});

describe('geometry, resolution, robust point set', () => {
  const p = { lat: 44.35, lon: -68.22 };
  it('destination point and bearing are consistent with the haversine distance', () => {
    for (const b of [0, 45, 137, 270, 359]) {
      const q = destinationPoint(p, b, 25000);
      expect(haversine_m(p, q)).toBeCloseTo(25000, 3);
      expect(((bearing_deg(p, q) - b + 540) % 360) - 180).toBeCloseTo(0, 6);
    }
  });

  it('resolution text states radial spacing (2πR/N), step and terrain cell', () => {
    const r = coverageResolution({ radials: 720, radius_m: 30000, step_m: 100, cellSize_m: 28, zoom: 12 });
    expect(r.radialSpacingAtEdge_m).toBeCloseTo(261.8, 1); // plan 6: 720 radials at 30 km ≈ 262 m
    expect(r.text).toContain('720 radials (≈ 262 m apart at 30.0 km)');
    expect(r.text).toContain('not accuracy');
  });

  it('uncertainty samples lie within the radius', () => {
    const s = uncertaintySamples(p, 200);
    expect(s.length).toBe(17);
    expect(Math.max(...s.map((q) => haversine_m(p, q)))).toBeCloseTo(200, 3);
  });

  it('robust point set returns the worst margin within the radius; unsupported samples make it unknown', async () => {
    const east = (q: { lon: number }) => (q.lon - p.lon) * 1e4; // margin falls to the west
    const [r] = await robustPointSet([p], 300, async (q) => east(q));
    expect(r!.worst_db).toBeLessThan(0);
    expect(r!.at.lon).toBeLessThan(p.lon);
    const [u] = await robustPointSet([p], 300, async (q) => (q.lat > p.lat + 0.002 ? Number.NaN : 1));
    expect(Number.isNaN(u!.worst_db)).toBe(true);
    expect(u!.unsupported).toBeGreaterThan(0);
  });
});
