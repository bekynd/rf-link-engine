// Terrain profile validation and resampling (plan 4.1, ticket T1).
// Rules: sample distances strictly increase; the profile handed to ITM has uniform spacing in
// NTIA's format (pfl[0] = number of intervals, pfl[1] = spacing, then elevations); elevations need
// only be finite (terrain rises and falls; monotonicity is never checked). Resampling happens here
// and the returned UniformProfile is exactly what ITM receives (stored with results, plan 15).
import { WRAPPER_LIMITS } from './validity.ts';

export type GeometryErrorCode =
  | 'ZERO_LENGTH'
  | 'COINCIDENT_TERMINALS'
  | 'TOO_FEW_SAMPLES'
  | 'LENGTH_MISMATCH'
  | 'NOT_STARTING_AT_ZERO'
  | 'NON_FINITE_DISTANCE'
  | 'NON_INCREASING_DISTANCE'
  | 'NON_FINITE_ELEVATION'
  | 'BAD_SPACING'
  | 'BAD_PFL';

export class GeometryError extends Error {
  readonly code: GeometryErrorCode;
  constructor(code: GeometryErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GeometryError';
  }
}

/** Samples along the path from terminal A (distance 0) to terminal B. */
export interface SampledProfile {
  distances_m: readonly number[];
  elevations_m: readonly number[];
}

/** Uniformly spaced profile: elevations_m.length = intervals + 1. */
export interface UniformProfile {
  spacing_m: number;
  elevations_m: readonly number[];
}

export function validateSampled(p: SampledProfile): void {
  const { distances_m: x, elevations_m: e } = p;
  if (x.length !== e.length) throw new GeometryError('LENGTH_MISMATCH', 'distances and elevations differ in length');
  if (x.length < 2) throw new GeometryError('TOO_FEW_SAMPLES', 'a profile needs at least two samples');
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) throw new GeometryError('NON_FINITE_DISTANCE', `distance ${i} is not finite`);
    if (!Number.isFinite(e[i])) throw new GeometryError('NON_FINITE_ELEVATION', `elevation ${i} is not finite`);
    if (i > 0 && !((x[i] as number) > (x[i - 1] as number))) {
      throw new GeometryError('NON_INCREASING_DISTANCE', `distance ${i} (${x[i]} m) does not exceed distance ${i - 1} (${x[i - 1]} m)`);
    }
  }
  if (x[0] !== 0) throw new GeometryError('NOT_STARTING_AT_ZERO', 'the first sample must be at distance 0 (terminal A)');
  if (!((x[x.length - 1] as number) > 0)) throw new GeometryError('ZERO_LENGTH', 'path length is zero');
}

function isUniform(x: readonly number[]): boolean {
  const n = x.length - 1;
  const step = (x[n] as number) / n;
  for (let i = 0; i <= n; i++) {
    if (Math.abs((x[i] as number) - i * step) > 1e-9 * Math.max(1, x[n] as number)) return false;
  }
  return true;
}

/**
 * Resamples to uniform spacing by linear interpolation. If the input is already uniform it is
 * returned unchanged (no interpolation error). `targetSpacing_m` defaults to the input's mean
 * spacing; the interval count is never below WRAPPER_LIMITS.minIntervals.
 */
export function resampleUniform(p: SampledProfile, targetSpacing_m?: number): UniformProfile {
  validateSampled(p);
  const x = p.distances_m;
  const e = p.elevations_m;
  const length = x[x.length - 1] as number;
  const meanSpacing = length / (x.length - 1);
  if (targetSpacing_m !== undefined && !(targetSpacing_m > 0 && Number.isFinite(targetSpacing_m))) {
    throw new GeometryError('BAD_SPACING', 'target spacing must be a positive finite number');
  }
  const intervals = Math.max(WRAPPER_LIMITS.minIntervals, Math.round(length / (targetSpacing_m ?? meanSpacing)));
  if (intervals === x.length - 1 && isUniform(x)) {
    return { spacing_m: length / intervals, elevations_m: [...e] };
  }
  const spacing = length / intervals;
  const out: number[] = new Array(intervals + 1);
  let j = 0;
  for (let i = 0; i <= intervals; i++) {
    const xi = i === intervals ? length : i * spacing;
    while (j < x.length - 2 && (x[j + 1] as number) < xi) j++;
    const x0 = x[j] as number;
    const x1 = x[j + 1] as number;
    const t = (xi - x0) / (x1 - x0);
    out[i] = (e[j] as number) + t * ((e[j + 1] as number) - (e[j] as number));
  }
  return { spacing_m: spacing, elevations_m: out };
}

/** Validates a uniform profile for ITM (wrapper rules, T1). */
export function validateUniform(u: UniformProfile): void {
  const n = u.elevations_m.length - 1;
  if (n < WRAPPER_LIMITS.minIntervals) {
    throw new GeometryError('TOO_FEW_SAMPLES', `at least ${WRAPPER_LIMITS.minIntervals} intervals are required (got ${n})`);
  }
  if (!(u.spacing_m > 0 && Number.isFinite(u.spacing_m))) throw new GeometryError('BAD_SPACING', 'spacing must be a positive finite number');
  u.elevations_m.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new GeometryError('NON_FINITE_ELEVATION', `elevation ${i} is not finite`);
  });
}

/** NTIA format: [np, spacing, e_0 ... e_np]. */
export function toPfl(u: UniformProfile): Float64Array {
  validateUniform(u);
  const n = u.elevations_m.length - 1;
  const pfl = new Float64Array(n + 3);
  pfl[0] = n;
  pfl[1] = u.spacing_m;
  pfl.set(u.elevations_m, 2);
  return pfl;
}

export function fromPfl(pfl: ArrayLike<number>): UniformProfile {
  const n = pfl[0] as number;
  if (!Number.isInteger(n) || pfl.length !== n + 3) throw new GeometryError('BAD_PFL', 'pfl[0] must equal the number of intervals (length - 3)');
  const u = { spacing_m: pfl[1] as number, elevations_m: Array.from({ length: n + 1 }, (_, i) => pfl[i + 2] as number) };
  validateUniform(u);
  return u;
}

export const profileLength_m = (u: UniformProfile) => u.spacing_m * (u.elevations_m.length - 1);
