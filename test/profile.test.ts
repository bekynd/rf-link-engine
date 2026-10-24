// Ticket T1 acceptance: profile validation and resampling.
import { beforeAll, describe, expect, it } from 'vitest';
import { GeometryError, fromPfl, resampleUniform, toPfl, validateSampled } from '../src/profile.ts';
import { predictPathLoss } from '../src/path.ts';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { request, synth } from './helpers.ts';

let wasm: EngineWasm;
beforeAll(async () => { wasm = await loadEngineWasm(); });

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof GeometryError ? e.code : 'OTHER'; }
  return 'NONE';
};

describe('T1 profile validation', () => {
  it('a rising-then-falling terrain profile passes (elevation monotonicity is never checked)', () => {
    const x = Array.from({ length: 101 }, (_, i) => i * 50);
    const e = x.map((d) => 200 + 300 * Math.sin((Math.PI * d) / 5000));
    expect(code(() => validateSampled({ distances_m: x, elevations_m: e }))).toBe('NONE');
    const r = predictPathLoss(wasm, request(resampleUniform({ distances_m: x, elevations_m: e })));
    expect(r.status).toBe('ok');
  });

  it('non-increasing distances fail with a specific error', () => {
    expect(code(() => validateSampled({ distances_m: [0, 10, 10, 30], elevations_m: [1, 2, 3, 4] }))).toBe('NON_INCREASING_DISTANCE');
    expect(code(() => validateSampled({ distances_m: [0, 20, 10, 30], elevations_m: [1, 2, 3, 4] }))).toBe('NON_INCREASING_DISTANCE');
  });

  it('NaN elevation fails; NaN distance fails', () => {
    expect(code(() => validateSampled({ distances_m: [0, 10, 20], elevations_m: [1, Number.NaN, 3] }))).toBe('NON_FINITE_ELEVATION');
    expect(code(() => validateSampled({ distances_m: [0, Number.NaN, 20], elevations_m: [1, 2, 3] }))).toBe('NON_FINITE_DISTANCE');
    const bad = synth(5000, 50, () => 100);
    (bad.elevations_m as number[])[7] = Number.NaN;
    const r = predictPathLoss(wasm, request(bad));
    expect(r.status).toBe('unsupported');
    expect(r.issues[0]?.code).toBe('NON_FINITE_ELEVATION');
  });

  it('zero-length, too few samples, coincident terminals are rejected before ITM', () => {
    expect(code(() => validateSampled({ distances_m: [0], elevations_m: [1] }))).toBe('TOO_FEW_SAMPLES');
    expect(code(() => toPfl({ spacing_m: 10, elevations_m: [1, 2, 3] }))).toBe('TOO_FEW_SAMPLES');
    expect(code(() => toPfl({ spacing_m: 0, elevations_m: new Array(20).fill(1) }))).toBe('BAD_SPACING');
    const r = predictPathLoss(wasm, request(synth(5000, 50, () => 1), { coincidentTerminals: true }));
    expect(r.status).toBe('unsupported');
    expect(r.issues[0]?.code).toBe('COINCIDENT_TERMINALS');
  });

  it('non-uniform input is resampled and the stored profile equals what ITM received', () => {
    const x = [0, 3, 10, 25, 60, 100, 180, 260, 400, 555, 700, 1000];
    const e = [5, 6, 9, 4, 12, 30, 22, 18, 25, 11, 7, 3];
    const u = resampleUniform({ distances_m: x, elevations_m: e }, 50);
    expect(u.elevations_m.length - 1).toBe(20);
    expect(u.spacing_m).toBeCloseTo(50, 12);
    expect(u.elevations_m[0]).toBe(5);
    expect(u.elevations_m[20]).toBe(3);
    const pfl = toPfl(u);
    expect(fromPfl(pfl)).toEqual(u); // round trip: the stored profile is the ITM input
    const r = predictPathLoss(wasm, request(u, { heights: { a_m: 5, b_m: 5 } }));
    expect(r.profile).toBe(u);
  });

  it('uniform input is passed through without interpolation', () => {
    const x = Array.from({ length: 31 }, (_, i) => i * 33.3);
    const e = x.map((d) => Math.round(d) % 17);
    const u = resampleUniform({ distances_m: x, elevations_m: e });
    expect(u.elevations_m).toEqual(e);
  });
});
