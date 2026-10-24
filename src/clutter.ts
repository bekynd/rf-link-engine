// Option B terminal clutter: ITU-R P.2108-1 §3.1 height-gain terminal correction applied with the
// reference-height recipe of plan A.9 (ticket T4). This is this application's modeling choice for
// combining ITM with P.2108; the combined result is labeled "combined model: experimental".
//
// Per terminal:
//  1. clutter type from land cover, R editable with provenance;
//  2. suburban/urban/dense urban/trees-forest with h < R: ITM at R, add A_h(h, R, f, type);
//  3. same types with h >= R: ITM at h, A_h = 0;
//  4. open/rural and water/sea: ITM at h, NO correction (application choice; P.2108 Eq. 2b would
//     give a nonzero value, see decisions.md §3 and the T4 reference report).
import type { EngineWasm } from './wasm.ts';
import { CLUTTER_CODE, type TerminalClutter } from './environment.ts';
import { P2108_ERRORS } from './ntia.ts';
import type { ValidityIssue } from './validity.ts';

export type ClutterTreatment = 'p2108-height-gain' | 'none-open' | 'none-above-clutter';

export interface TerminalClutterResult {
  treatment: ClutterTreatment;
  /** Actual antenna height AGL (geometry, angles, profile display). */
  actualHeight_m: number;
  /** Height given to ITM. */
  itmHeight_m: number;
  R_m: number;
  /** Correction added to ITM loss (dB). */
  A_h_db: number;
  label: string;
  issues: ValidityIssue[];
}

export const OPEN_LABEL = 'no clutter correction (open; application choice)';

const OPEN_TYPES = new Set(['open-rural', 'water-sea']);

export function terminalClutter(wasm: EngineWasm, c: TerminalClutter, h_m: number, f_mhz: number): TerminalClutterResult {
  const base = { actualHeight_m: h_m, R_m: c.R_m };
  if (OPEN_TYPES.has(c.type)) {
    return { ...base, treatment: 'none-open', itmHeight_m: h_m, A_h_db: 0, label: OPEN_LABEL, issues: [] };
  }
  if (h_m >= c.R_m) {
    return {
      ...base, treatment: 'none-above-clutter', itmHeight_m: h_m, A_h_db: 0,
      label: `antenna at or above representative clutter height (h=${h_m} m ≥ R=${c.R_m} m): no correction`, issues: [],
    };
  }
  const r = wasm.p2108HeightGain(f_mhz / 1000, h_m, c.streetWidth_m, c.R_m, CLUTTER_CODE[c.type]);
  if (r.rtn !== 0) {
    return {
      ...base, treatment: 'p2108-height-gain', itmHeight_m: c.R_m, A_h_db: Number.NaN, label: 'P.2108 terminal correction unsupported',
      issues: [{ zone: 'error', code: `P2108_${r.rtn}`, message: P2108_ERRORS[r.rtn] ?? `P.2108 error ${r.rtn}`, source: 'NTIA P.2108' }],
    };
  }
  return {
    ...base, treatment: 'p2108-height-gain', itmHeight_m: c.R_m, A_h_db: r.A_h_db,
    label: `P.2108 terminal correction A_h (${c.type}, h=${h_m} m, R=${c.R_m} m)`, issues: [],
  };
}
