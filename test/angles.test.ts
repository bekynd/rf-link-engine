// Plan 4.1 acceptance: mode-dependent antenna pointing angles.
import { beforeAll, describe, expect, it } from 'vitest';
import { directAngles } from '../src/angles.ts';
import { gainToward } from '../src/antenna.ts';
import { PropagationMode } from '../src/ntia.ts';
import { predictPathLoss } from '../src/path.ts';
import { toPfl } from '../src/profile.ts';
import { effectiveEarthRadius_m } from '../src/refractivity.ts';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { hill, request, synth } from './helpers.ts';

let wasm: EngineWasm;
beforeAll(async () => { wasm = await loadEngineWasm(); });

describe('4.1 pointing angles', () => {
  it('unequal-height LOS with directional antennas uses the direct geometry, not ITM’s effective LOS angle', () => {
    // A on a 400 m hilltop, B in the valley 3 km away, clear line of sight.
    const u = synth(3000, 300, (x) => 400 - 400 * Math.min(1, x * 1.2));
    const r = predictPathLoss(wasm, request(u, { f_mhz: 446, heights: { a_m: 10, b_m: 10 } }));
    expect(r.status).toBe('ok');
    expect(r.itm!.mode).toBe(PropagationMode.LINE_OF_SIGHT);
    expect(r.angles!.basis).toBe('direct');

    const a_e = r.refractivity!.a_e_m;
    const [aDirect, bDirect] = directAngles(400 + 10, 0 + 10, 3000, a_e);
    expect(r.angles!.a_rad).toBe(aDirect);
    expect(r.angles!.b_rad).toBe(bDirect);

    // ITM replaced its horizon angles with fitted values on this LOS path (QuickPfl):
    const itmTheta = r.itm!.theta_hzn[0];
    expect(Math.abs(itmTheta - aDirect)).toBeGreaterThan(0.01); // > 0.57°

    // With a directional antenna (12° vertical beamwidth, no tilt) the two angles give different gains;
    // the engine's angle is the direct one, so using ITM's angle would fail this check.
    const pattern = { gain_dbi: 9, verticalBeamwidth_deg: 12 };
    const gDirect = gainToward(pattern, {}, aDirect, 0);
    const gItm = gainToward(pattern, {}, itmTheta, 0);
    expect(gainToward(pattern, {}, r.angles!.a_rad, 0)).toBe(gDirect);
    expect(Math.abs(gDirect - gItm)).toBeGreaterThan(1);
  });

  it('obstructed paths use the raw terrain horizon angle, labeled an approximation', () => {
    const u = hill(20000, 300, 400, 100);
    const r = predictPathLoss(wasm, request(u, { f_mhz: 146, heights: { a_m: 2, b_m: 2 } }));
    expect(r.angles!.geometricLineOfSight).toBe(false);
    expect(r.angles!.horizonDistance_m[0]).toBeCloseTo(9850, 6); // the summit
    expect(r.angles!.basis).toBe('horizon');
    expect(r.angles!.label).toMatch(/dominant obstacle/);
    const raw = wasm.findHorizons(toPfl(u), r.refractivity!.a_e_m, 2, 2);
    expect(r.angles!.a_rad).toBe(raw.theta[0]);
  });

  it('ITM "line-of-sight" mode is not geometric line of sight (PC12): a ridge-blocked path ITM labels LOS still uses the horizon angle', () => {
    const u = hill(20000, 300, 400, 100);
    const r = predictPathLoss(wasm, request(u, { f_mhz: 146, heights: { a_m: 2, b_m: 2 } }));
    // effective heights from ITM's terrain fit (~27 m) make d_sML > d, so ITM reports mode 1
    expect(r.itm!.mode).toBe(PropagationMode.LINE_OF_SIGHT);
    expect(r.angles!.geometricLineOfSight).toBe(false);
    expect(r.angles!.basis).toBe('horizon');
  });

  it('angles use the actual heights when ITM ran at the clutter reference height (A.9)', () => {
    const u = synth(3000, 300, (x) => 400 - 400 * Math.min(1, x * 1.2));
    const r = predictPathLoss(wasm, request(u, {
      f_mhz: 446, heights: { a_m: 2, b_m: 1.5 },
      environment: { option: 'B', a: { type: 'suburban', R_m: 10, streetWidth_m: 27, provenance: { status: 'model-default', source: 't', date: '2026-10-24' } }, b: { type: 'suburban', R_m: 10, streetWidth_m: 27, provenance: { status: 'model-default', source: 't', date: '2026-10-24' } } },
    }));
    expect(r.itmHeights).toEqual({ a_m: 10, b_m: 10 });
    const [aDirect] = directAngles(400 + 2, 0 + 1.5, 3000, effectiveEarthRadius_m(r.refractivity!.N_s));
    expect(r.angles!.a_rad).toBe(aDirect);
  });
});
