// Loads the NTIA ITM + P.2108 WebAssembly module and exposes typed, allocation-safe calls.
// This layer only marshals numbers; geometry validation lives in profile.ts (plan 4.1, T1).
import factory, { type RflpWasmModule } from '../wasm/rflp-engine.mjs';

export interface ItmRaw {
  rtn: number;
  /** Basic transmission loss (dB). */
  A_db: number;
  warnings: number;
  theta_hzn: [number, number];
  d_hzn_m: [number, number];
  h_e_m: [number, number];
  N_s: number;
  delta_h_m: number;
  A_ref_db: number;
  A_fs_db: number;
  d_km: number;
  mode: number;
}

export interface ItmCall {
  h_tx_m: number;
  h_rx_m: number;
  /** NTIA profile format: [np, spacing, e_0 ... e_np]. */
  pfl: Float64Array;
  climate: number;
  N_0: number;
  f_mhz: number;
  pol: number;
  epsilon: number;
  sigma: number;
  mdvar: number;
  time: number;
  location: number;
  situation: number;
}

export interface EngineWasm {
  itmP2P(call: ItmCall): ItmRaw;
  /** FindHorizons on the profile with effective earth radius a_e (m) and the given structural heights. */
  findHorizons(pfl: Float64Array, a_e_m: number, h_tx_m: number, h_rx_m: number): { theta: [number, number]; d_m: [number, number] };
  /** P.2108 section 3.1. */
  p2108HeightGain(f_ghz: number, h_m: number, w_s_m: number, R_m: number, clutterType: number): { rtn: number; A_h_db: number };
  /** P.2108 section 3.2. */
  p2108Terrestrial(f_ghz: number, d_km: number, p: number): { rtn: number; L_ctt_db: number };
}

function wrap(m: RflpWasmModule): EngineWasm {
  const OUT = 16;
  const outPtr = m._malloc(OUT * 8);
  let pflPtr = 0;
  let pflCap = 0;

  const putPfl = (pfl: Float64Array): number => {
    if (pfl.length > pflCap) {
      if (pflPtr) m._free(pflPtr);
      pflCap = Math.max(pfl.length, 1024);
      pflPtr = m._malloc(pflCap * 8);
    }
    m.HEAPF64.set(pfl, pflPtr / 8);
    return pflPtr;
  };
  const out = (i: number): number => m.HEAPF64[outPtr / 8 + i] as number;

  return {
    itmP2P(c) {
      const p = putPfl(c.pfl);
      m._rflp_itm_p2p(c.h_tx_m, c.h_rx_m, p, c.climate, c.N_0, c.f_mhz, c.pol, c.epsilon, c.sigma,
        c.mdvar, c.time, c.location, c.situation, outPtr);
      return {
        rtn: out(0), A_db: out(1), warnings: out(2),
        theta_hzn: [out(3), out(4)], d_hzn_m: [out(5), out(6)], h_e_m: [out(7), out(8)],
        N_s: out(9), delta_h_m: out(10), A_ref_db: out(11), A_fs_db: out(12), d_km: out(13), mode: out(14),
      };
    },
    findHorizons(pfl, a_e, h_tx, h_rx) {
      const p = putPfl(pfl);
      m._rflp_find_horizons(p, a_e, h_tx, h_rx, outPtr);
      return { theta: [out(0), out(1)], d_m: [out(2), out(3)] };
    },
    p2108HeightGain(f, h, ws, R, type) {
      const rtn = m._rflp_p2108_hgtc(f, h, ws, R, type, outPtr);
      return { rtn, A_h_db: out(0) };
    },
    p2108Terrestrial(f, d, p) {
      const rtn = m._rflp_p2108_tsm(f, d, p, outPtr);
      return { rtn, L_ctt_db: out(0) };
    },
  };
}

let cached: Promise<EngineWasm> | undefined;

/** Loads the module once per realm (main thread, each worker, or Node). */
export function loadEngineWasm(options?: { wasmBinary?: ArrayBuffer | Uint8Array }): Promise<EngineWasm> {
  cached ??= factory(options).then(wrap);
  return cached;
}
