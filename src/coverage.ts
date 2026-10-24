// Coverage maps (plan 6): one terrain profile per radial from the station, ITM evaluated on
// successive PREFIXES of that profile at the along-radial step. Each prefix call still runs ITM's
// full profile processing (horizons, Δh, fits): the result at a point is exactly the point-to-point
// result for the truncated profile (test/coverage.test.ts), not an approximation of it.
// Receiver-specific: "transmitter X as heard by a receiver at height Z", with the receiver's
// clutter (Option B) per output point. Also: effective-resolution labels, destination points,
// and the robust point-set primitive reused by the relay optimizer and repeater check (8, 9.3).
import { pointingAngles } from './angles.ts';
import { terminalClutter, type TerminalClutterResult } from './clutter.ts';
import { ClutterTypeName, type TerminalClutter } from './environment.ts';
import { ITM_SUCCESS_WITH_WARNINGS } from './ntia.ts';
import { resampleUniform } from './profile.ts';
import { deriveRefractivity } from './refractivity.ts';
import type { LatLon } from './terrain.ts';
import type { VariabilityColumn } from './labels.ts';
import { checkItmParams, hasError, WRAPPER_LIMITS } from './validity.ts';
import type { EngineWasm } from './wasm.ts';

const EARTH_RADIUS_M = 6371008.8; // same sphere as terrain.ts

/** Point at distance d_m along bearing (degrees clockwise from north) from p, on the sphere. */
export function destinationPoint(p: LatLon, bearing_deg: number, d_m: number): LatLon {
  const r = Math.PI / 180;
  const δ = d_m / EARTH_RADIUS_M, θ = bearing_deg * r, φ1 = p.lat * r, λ1 = p.lon * r;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / r, lon: ((((λ2 / r) + 540) % 360) - 180) };
}

/** Output flags per point (bit set). */
export const COVERAGE_FLAG = {
  /** ITM or the terminal correction returned an error: no value (never a guessed one). */
  UNSUPPORTED: 1,
  /** ITM returned warnings for this point. */
  ITM_WARNING: 2,
  /** Shorter than 1 km: extrapolated beyond the documented range (plan 2). */
  EXTRAPOLATED: 4,
  /** Receiver clutter type unknown at this point; the fallback type was used. */
  CLUTTER_FALLBACK: 8,
  /** Geometric line of sight between the actual antenna heights (plan 4.1, PC12). */
  LINE_OF_SIGHT: 16,
} as const;

/** Receiver clutter types are passed per point as indexes into this list (255 = unknown). */
export const CLUTTER_INDEX = ClutterTypeName.options;
export const CLUTTER_UNKNOWN = 255;

export interface RadialRequest {
  /** Uniform profile from the transmitter (index 0) outward. */
  elevations_m: ArrayLike<number>;
  spacing_m: number;
  /** One output point every `every` intervals: along-radial step = every·spacing_m. */
  every: number;
  f_mhz: number;
  climate: number;
  N_0: number;
  polarization: number;
  ground: { epsilon: number; sigma: number };
  variability: { mode: number; column: VariabilityColumn };
  /** Transmitter: actual height and its clutter (null: Option A, bare earth). */
  tx: { height_m: number; clutter: TerminalClutter | null };
  /**
   * Receiver: actual height; with Option B, clutter parameters per type and the type index per
   * output point (CLUTTER_INDEX, 255 = unknown → `fallback`). null: Option A.
   */
  rx: { height_m: number; clutter: { byType: Partial<Record<ClutterTypeName, TerminalClutter>>; perPoint: ArrayLike<number>; fallback: ClutterTypeName } | null };
  /**
   * Pointing angles per point (plan 4.1). Needed only when an antenna has a vertical pattern; when
   * false, angles are NaN and LINE_OF_SIGHT is not evaluated (saves ~40 % of the work). Default true.
   */
  angles?: boolean;
}

export interface RadialResult {
  /** Distance of each output point from the transmitter (m). */
  distance_m: Float64Array;
  /** Total loss (ITM + environment correction) per point (dB); NaN where unsupported. */
  loss_db: Float32Array;
  /** Mode-dependent pointing angles (plan 4.1) at the transmitter and the receiver (rad, positive up). */
  txAngle_rad: Float32Array;
  rxAngle_rad: Float32Array;
  flags: Uint8Array;
  /** Distinct issue codes seen on this radial (for the result's label list). */
  issues: string[];
}

/** Number of output points for a radial of `intervals` intervals. */
export const radialPoints = (intervals: number, every: number) => Math.floor(intervals / every);

/** Path loss at every along-radial step of one radial (one variability column). */
export function radialPrefixLosses(wasm: EngineWasm, req: RadialRequest): RadialResult {
  const n = req.elevations_m.length - 1;
  const m = radialPoints(n, req.every);
  const out: RadialResult = {
    distance_m: new Float64Array(m), loss_db: new Float32Array(m).fill(Number.NaN), txAngle_rad: new Float32Array(m).fill(Number.NaN),
    rxAngle_rad: new Float32Array(m).fill(Number.NaN), flags: new Uint8Array(m), issues: [],
  };
  const issues = new Set<string>();
  const { mode, column: c } = req.variability;
  const singleMessage = mode % 10 === 0;
  const time = singleMessage ? c.situation : c.time;
  const location = singleMessage ? c.situation : c.location;

  const tx: TerminalClutterResult | null = req.tx.clutter ? terminalClutter(wasm, req.tx.clutter, req.tx.height_m, req.f_mhz) : null;
  for (const i of tx?.issues ?? []) issues.add(i.code);
  const rxByType = new Map<ClutterTypeName, TerminalClutterResult>();
  const rxFor = (type: ClutterTypeName): TerminalClutterResult => {
    let r = rxByType.get(type);
    if (!r) {
      const params = req.rx.clutter!.byType[type];
      if (!params) throw new RangeError(`no receiver clutter parameters for ${type}`);
      r = terminalClutter(wasm, params, req.rx.height_m, req.f_mhz);
      rxByType.set(type, r);
    }
    return r;
  };
  // Parameter checks once per distinct receiver ITM height (a handful at most).
  const checked = new Map<number, boolean>();
  const paramsOk = (hTx: number, hRx: number): boolean => {
    let ok = checked.get(hRx);
    if (ok === undefined) {
      const found = checkItmParams({
        f_mhz: req.f_mhz, h_tx_m: hTx, h_rx_m: hRx, N_0: req.N_0, climate: req.climate, pol: req.polarization,
        epsilon: req.ground.epsilon, sigma: req.ground.sigma, mdvar: mode, time, location, situation: c.situation,
      });
      for (const f of found) issues.add(f.code);
      ok = !hasError(found);
      checked.set(hRx, ok);
    }
    return ok;
  };

  // NTIA format buffer for the full radial; a prefix of k intervals is [k, spacing, e_0..e_k].
  const full = new Float64Array(n + 3);
  full[1] = req.spacing_m;
  for (let i = 0; i <= n; i++) full[i + 2] = req.elevations_m[i] as number;
  const minK = WRAPPER_LIMITS.minIntervals;

  for (let j = 0; j < m; j++) {
    const k = (j + 1) * req.every;
    const d = k * req.spacing_m;
    out.distance_m[j] = d;
    let flags = d < WRAPPER_LIMITS.extrapolatedBelowM ? COVERAGE_FLAG.EXTRAPOLATED : 0;
    let rx: TerminalClutterResult | null = null;
    if (req.rx.clutter) {
      const idx = req.rx.clutter.perPoint[j] as number;
      const type = idx === CLUTTER_UNKNOWN || CLUTTER_INDEX[idx] === undefined ? (flags |= COVERAGE_FLAG.CLUTTER_FALLBACK, req.rx.clutter.fallback) : CLUTTER_INDEX[idx]!;
      rx = rxFor(type);
      for (const i of rx.issues) issues.add(i.code);
    }
    const hTx = tx?.itmHeight_m ?? req.tx.height_m;
    const hRx = rx?.itmHeight_m ?? req.rx.height_m;
    const env = (tx?.A_h_db ?? 0) + (rx?.A_h_db ?? 0);
    if (!Number.isFinite(env) || !paramsOk(hTx, hRx)) {
      out.flags[j] = flags | COVERAGE_FLAG.UNSUPPORTED;
      continue;
    }
    let pfl: Float64Array;
    if (k >= minK) {
      full[0] = k;
      pfl = full.subarray(0, k + 3);
    } else {
      // Fewer intervals than the wrapper allows: resample the prefix (linear interpolation).
      const xs = Array.from({ length: k + 1 }, (_, i) => i * req.spacing_m);
      const u = resampleUniform({ distances_m: xs, elevations_m: Array.from(full.subarray(2, k + 3)) }, d / minK);
      pfl = new Float64Array(u.elevations_m.length + 2);
      pfl[0] = u.elevations_m.length - 1;
      pfl[1] = u.spacing_m;
      pfl.set(u.elevations_m, 2);
    }
    const r = wasm.itmP2P({
      h_tx_m: hTx, h_rx_m: hRx, pfl, climate: req.climate, N_0: req.N_0, f_mhz: req.f_mhz, pol: req.polarization,
      epsilon: req.ground.epsilon, sigma: req.ground.sigma, mdvar: mode, time, location, situation: c.situation,
    });
    if (r.rtn > ITM_SUCCESS_WITH_WARNINGS) {
      issues.add(`ITM_${r.rtn}`);
      out.flags[j] = flags | COVERAGE_FLAG.UNSUPPORTED;
      continue;
    }
    if (r.warnings) flags |= COVERAGE_FLAG.ITM_WARNING;
    out.loss_db[j] = r.A_db + env;
    if (req.angles === false) { out.flags[j] = flags; continue; }
    const ang = pointingAngles({ wasm, mode: r.mode, pfl, a_e_m: deriveRefractivity(req.N_0, pfl).a_e_m, hA_actual_m: req.tx.height_m, hB_actual_m: req.rx.height_m });
    if (ang.geometricLineOfSight) flags |= COVERAGE_FLAG.LINE_OF_SIGHT;
    out.txAngle_rad[j] = ang.a_rad;
    out.rxAngle_rad[j] = ang.b_rad;
    out.flags[j] = flags;
  }
  out.issues = [...issues].sort();
  return out;
}

export interface CoverageResolution {
  /** Spacing between adjacent radials at the coverage edge (m): 2πR/N. */
  radialSpacingAtEdge_m: number;
  text: string;
}

/** Honest resolution on all axes (plan 6); the displayed raster cell is never claimed as accuracy. */
export function coverageResolution(o: { radials: number; radius_m: number; step_m: number; cellSize_m: number; zoom: number }): CoverageResolution {
  const s = (2 * Math.PI * o.radius_m) / o.radials;
  const m = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`);
  return {
    radialSpacingAtEdge_m: s,
    text: `${o.radials} radials (≈ ${m(s)} apart at ${m(o.radius_m)}), ${m(o.step_m)} steps along each, terrain cell ${m(o.cellSize_m)} (z${o.zoom}). Map cells are drawing resolution, not accuracy.`,
  };
}

/** Points sampled within a location-uncertainty radius: the center plus `perRing` points on each ring. */
export function uncertaintySamples(center: LatLon, radius_m: number, rings = 2, perRing = 8): LatLon[] {
  const out: LatLon[] = [center];
  if (!(radius_m > 0)) return out;
  for (let r = 1; r <= rings; r++) {
    const d = (radius_m * r) / rings;
    const offset = r % 2 ? 0 : 180 / perRing; // stagger rings
    for (let i = 0; i < perRing; i++) out.push(destinationPoint(center, offset + (360 * i) / perRing, d));
  }
  return out;
}

export interface RobustPoint {
  point: LatLon;
  /** Worst (lowest) margin among the samples (dB); NaN if any sample was unsupported. */
  worst_db: number;
  /** Where the worst sample is. */
  at: LatLon;
  samples: number;
  unsupported: number;
}

/**
 * Robust point-set evaluation (plan 6; reused by 8 and 9.3): per candidate point, the worst margin
 * within its location-uncertainty radius. An unsupported sample makes the point's result unknown
 * (NaN) rather than letting the remaining samples look better than they are.
 */
export async function robustPointSet(
  points: readonly LatLon[],
  radius_m: number,
  evaluate: (p: LatLon) => Promise<number>,
  opts: { rings?: number; perRing?: number; signal?: AbortSignal } = {},
): Promise<RobustPoint[]> {
  return Promise.all(points.map(async (point) => {
    const samples = uncertaintySamples(point, radius_m, opts.rings, opts.perRing);
    const values = await Promise.all(samples.map((s) => {
      if (opts.signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      return evaluate(s);
    }));
    let worst = Infinity, at = point, unsupported = 0;
    values.forEach((v, i) => {
      if (!Number.isFinite(v)) unsupported++;
      else if (v < worst) { worst = v; at = samples[i]!; }
    });
    return { point, worst_db: unsupported ? Number.NaN : worst, at, samples: samples.length, unsupported };
  }));
}
