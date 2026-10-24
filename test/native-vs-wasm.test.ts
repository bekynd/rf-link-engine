// Plan 16.1 / phase 1 gate: the WebAssembly build matches the native NTIA build on identical
// inputs within 1e-6 dB, with identical return codes and warning flags. NTIA's published vectors
// (rounded to 0.01 dB) are checked at ±0.005 dB (decisions.md PC3).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { checkItmParams, hasError, WRAPPER_LIMITS } from '../src/validity.ts';
import { generateCases, type Case } from './cases.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOL_DB = 1e-6;

let wasm: EngineWasm;
let cases: Case[];
let golden: number[][];

beforeAll(async () => {
  wasm = await loadEngineWasm();
  cases = generateCases();
  golden = fs.readFileSync(path.join(here, 'golden', 'native.txt'), 'utf8').trim().split('\n').map((l) => l.split(' ').map(Number));
});

function runWasm(c: Case): number[] {
  switch (c.kind) {
    case 'itm': {
      const r = wasm.itmP2P({
        h_tx_m: c.h_tx, h_rx_m: c.h_rx, pfl: Float64Array.from(c.pfl), climate: c.climate, N_0: c.N0, f_mhz: c.f,
        pol: c.pol, epsilon: c.eps, sigma: c.sigma, mdvar: c.mdvar, time: c.time, location: c.loc, situation: c.sit,
      });
      return [r.rtn, r.A_db, r.warnings, ...r.theta_hzn, ...r.d_hzn_m, ...r.h_e_m, r.N_s, r.delta_h_m, r.A_ref_db, r.A_fs_db, r.d_km, r.mode, 0];
    }
    case 'hgtc': {
      const r = wasm.p2108HeightGain(c.f, c.h, c.ws, c.R, c.type);
      return [r.A_h_db, r.rtn];
    }
    case 'tsm': {
      const r = wasm.p2108Terrestrial(c.f, c.d, c.p);
      return [r.L_ctt_db, r.rtn];
    }
    case 'hzn': {
      const r = wasm.findHorizons(Float64Array.from(c.pfl), c.a_e, c.h_tx, c.h_rx);
      return [...r.theta, ...r.d_m];
    }
  }
}

describe('native vs WebAssembly (NTIA ITM + P.2108)', () => {
  it('golden file covers every generated case', () => {
    expect(golden.length).toBe(cases.length);
  });

  it('ITM: identical return codes, warnings, mode; loss within 1e-6 dB', () => {
    let maxDiff = 0;
    let n = 0;
    const byRtn: Record<number, number> = {};
    let ties = 0;
    cases.forEach((c, i) => {
      if (c.kind !== 'itm') return;
      if (c.eps < WRAPPER_LIMITS.epsilonMin && c.eps >= 1) {
        // Library tie: Re(Z_g) = |Im(Z_g)| exactly at eps = 1; native and WASM sqrt may round
        // differently (decisions.md PC11). Such inputs must never reach ITM: the wrapper rejects them.
        const issues = checkItmParams({ f_mhz: c.f, h_tx_m: c.h_tx, h_rx_m: c.h_rx, N_0: c.N0, climate: c.climate, pol: c.pol,
          epsilon: c.eps, sigma: c.sigma, mdvar: c.mdvar, time: c.time, location: c.loc, situation: c.sit });
        expect(hasError(issues), `case ${i} wrapper must reject eps=${c.eps}`).toBe(true);
        ties++;
        return;
      }
      const w = runWasm(c);
      const g = golden[i]!;
      expect(w[0], `case ${i} rtn`).toBe(g[0]);
      expect(w[2], `case ${i} warnings`).toBe(g[2]);
      expect(w[14], `case ${i} mode`).toBe(g[14]);
      byRtn[g[0]!] = (byRtn[g[0]!] ?? 0) + 1;
      for (const k of [1, 11, 12]) { // A, A_ref, A_fs (dB)
        const d = Math.abs(w[k]! - g[k]!);
        maxDiff = Math.max(maxDiff, d);
        expect(d, `case ${i} field ${k}`).toBeLessThanOrEqual(TOL_DB);
      }
      for (const k of [3, 4, 5, 6, 7, 8, 9, 10, 13]) { // intermediates: relative 1e-9
        const d = Math.abs(w[k]! - g[k]!);
        expect(d, `case ${i} field ${k}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(g[k]!)));
      }
      n++;
    });
    console.log(`ITM cases compared: ${n} (+${ties} eps<2 cases rejected by the wrapper); by return code ${JSON.stringify(byRtn)}; max |WASM-native| = ${maxDiff.toExponential(2)} dB`);
    expect(n).toBeGreaterThan(2900);
  });

  it('P.2108 and FindHorizons match', () => {
    let maxDiff = 0;
    cases.forEach((c, i) => {
      if (c.kind === 'itm') return;
      const w = runWasm(c);
      const g = golden[i]!;
      if (c.kind === 'hzn') {
        w.forEach((v, k) => expect(Math.abs(v - g[k]!)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(g[k]!))));
      } else {
        expect(w[1], `case ${i} rtn`).toBe(g[1]);
        const d = Math.abs(w[0]! - g[0]!);
        maxDiff = Math.max(maxDiff, d);
        expect(d).toBeLessThanOrEqual(TOL_DB);
      }
    });
    console.log(`P.2108 max |WASM-native| = ${maxDiff.toExponential(2)} dB`);
  });

  it("NTIA's published vectors (0.01 dB rounding) within ±0.005 dB", () => {
    const itmExpected = fs.readFileSync(path.join(here, '..', 'third_party', 'ntia-itm', 'p2p.csv'), 'utf8')
      .trim().split(/\r?\n/).slice(1).map((l) => Number(l.split(',')[12]));
    itmExpected.forEach((A, i) => expect(Math.abs(runWasm(cases[i]!)[1]! - A)).toBeLessThanOrEqual(0.005 + 1e-12));

    const read = (f: string) => fs.readFileSync(path.join(here, '..', 'third_party', 'ntia-p2108', 'test-data', f), 'utf8')
      .trim().split(/\r?\n/).slice(1).map((l) => l.split(',').map(Number));
    for (const v of read('HeightGainTerminalCorrectionModelTestData.csv')) {
      const r = wasm.p2108HeightGain(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!);
      expect(r.rtn).toBe(v[5]);
      if (r.rtn === 0) expect(Math.abs(r.A_h_db - v[6]!)).toBeLessThanOrEqual(0.1); // NTIA's own tolerance for this data (tests/TestUtils.h ABSTOL__DB = 0.1)
    }
    for (const v of read('TerrestrialStatisticalModelTestData.csv')) {
      const r = wasm.p2108Terrestrial(v[0]!, v[1]!, v[2]!);
      expect(r.rtn).toBe(v[3]);
      if (r.rtn === 0) expect(Math.abs(r.L_ctt_db - v[4]!)).toBeLessThanOrEqual(0.1);
    }
  });
});
