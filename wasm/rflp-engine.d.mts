// Types for the Emscripten-generated module (native/build.sh).
export interface RflpWasmModule {
  HEAPF64: Float64Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _rflp_itm_p2p(
    h_tx: number, h_rx: number, pfl: number, climate: number, N_0: number, f_mhz: number,
    pol: number, epsilon: number, sigma: number, mdvar: number, time: number,
    location: number, situation: number, out: number,
  ): number;
  _rflp_find_horizons(pfl: number, a_e: number, h_tx: number, h_rx: number, out: number): void;
  _rflp_p2108_hgtc(f_ghz: number, h: number, w_s: number, R: number, type: number, out: number): number;
  _rflp_p2108_tsm(f_ghz: number, d_km: number, p: number, out: number): number;
}
declare const factory: (options?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (path: string) => string }) => Promise<RflpWasmModule>;
export default factory;
