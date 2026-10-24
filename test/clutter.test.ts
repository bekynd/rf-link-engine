// Plan A.9 / ticket T4 acceptance: the reference-height recipe as written.
import { beforeAll, describe, expect, it } from 'vitest';
import { OPEN_LABEL, terminalClutter } from '../src/clutter.ts';
import { defaultTerminalClutter, type ClutterTypeName } from '../src/environment.ts';
import { LABEL_COMBINED_EXPERIMENTAL, LABEL_UNVALIDATED } from '../src/labels.ts';
import { predictPathLoss } from '../src/path.ts';
import { toPfl } from '../src/profile.ts';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { hill, request } from './helpers.ts';

let wasm: EngineWasm;
beforeAll(async () => { wasm = await loadEngineWasm(); });

const B = (a: ClutterTypeName, b: ClutterTypeName) => ({ option: 'B' as const, a: defaultTerminalClutter(a), b: defaultTerminalClutter(b) });

describe('A.9 reference-height recipe', () => {
  it('suburban terminal below R: ITM at R, A_h from P.2108 added, actual height kept for geometry', () => {
    const r = predictPathLoss(wasm, request(hill(15000, 120), { environment: B('suburban', 'open-rural'), heights: { a_m: 1.5, b_m: 12 } }));
    expect(r.status).toBe('ok');
    expect(r.itmHeights).toEqual({ a_m: 10, b_m: 12 });
    expect(r.terminals!.a.treatment).toBe('p2108-height-gain');
    expect(r.terminals!.a.actualHeight_m).toBe(1.5);
    const direct = wasm.p2108HeightGain(0.915, 1.5, 27, 10, 3).A_h_db;
    expect(r.terminals!.a.A_h_db).toBe(direct);
    expect(direct).toBeGreaterThan(0);
    const itmAtR = wasm.itmP2P({ h_tx_m: 10, h_rx_m: 12, pfl: toPfl(hill(15000, 120)), climate: 5, N_0: 301, f_mhz: 915, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, time: 50, location: 50, situation: 50 });
    expect(r.columns[0]!.totalLoss_db).toBe(itmAtR.A_db + direct);
  });

  it('open/rural and water/sea: ITM at actual h, no correction, labeled as an application choice', () => {
    for (const t of ['open-rural', 'water-sea'] as const) {
      const c = terminalClutter(wasm, defaultTerminalClutter(t), 1.5, 915);
      expect(c.A_h_db).toBe(0);
      expect(c.itmHeight_m).toBe(1.5);
      expect(c.label).toBe(OPEN_LABEL);
    }
  });

  it('h ≥ R: ITM at h, zero correction', () => {
    for (const t of ['suburban', 'urban', 'trees-forest', 'dense-urban'] as const) {
      const R = defaultTerminalClutter(t).R_m;
      for (const h of [R, R + 0.1, R + 50]) {
        const c = terminalClutter(wasm, defaultTerminalClutter(t), h, 915);
        expect(c.A_h_db).toBe(0);
        expect(c.itmHeight_m).toBe(h);
      }
    }
  });

  it('continuity at h = R is computed and reported (not asserted as an invariant)', () => {
    for (const t of ['suburban', 'urban', 'trees-forest', 'dense-urban'] as const) {
      const R = defaultTerminalClutter(t).R_m;
      const justBelow = terminalClutter(wasm, defaultTerminalClutter(t), R - 1e-6, 915).A_h_db;
      expect(Number.isFinite(justBelow)).toBe(true);
      console.log(`A_h(${t}, h = R − 1e-6) = ${justBelow.toExponential(3)} dB (step at h = R: ${justBelow.toExponential(3)} dB)`);
    }
  });

  it('quality badge: "combined model: experimental" for option B, absent for option A', () => {
    const b = predictPathLoss(wasm, request(hill(15000, 120), { environment: B('suburban', 'suburban') }));
    expect(b.labels).toContain(LABEL_COMBINED_EXPERIMENTAL);
    expect(b.labels).toContain(LABEL_UNVALIDATED);
    const a = predictPathLoss(wasm, request(hill(15000, 120)));
    expect(a.labels).not.toContain(LABEL_COMBINED_EXPERIMENTAL);
    expect(a.labels).toContain(LABEL_UNVALIDATED);
  });

  it('P.2108 outside 0.03-3 GHz is unsupported, never a silent number', () => {
    const r = predictPathLoss(wasm, request(hill(15000, 120), { f_mhz: 5800, environment: B('urban', 'urban') }));
    expect(r.status).toBe('unsupported');
    expect(r.issues.some((i) => i.code === 'P2108_32')).toBe(true);
  });

  it('options C and D are not available until phase 10 (unsupported, not silently ignored)', () => {
    const r = predictPathLoss(wasm, request(hill(15000, 120), { environment: { option: 'D', woodlandDepth_m: 50 } }));
    expect(r.status).toBe('unsupported');
  });
});
