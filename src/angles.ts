// Mode-dependent antenna pointing angles (plan 4.1). ITM's horizon angles are NOT the bearing to
// the other antenna on line-of-sight paths: QuickPfl replaces them with values from a least-squares
// fit and Δh. So:
//  - clear line of sight: direct terminal-to-terminal elevation angle from the geometry, with the
//    ITM-consistent effective earth (FindHorizons' initial expression, TN101 Eq 6.15);
//  - obstructed: raw terrain horizon angle (FindHorizons), labeled an approximation;
//  - troposcatter: horizon angle, with the statement that one angle does not describe the coupling.
// "Clear line of sight" is GEOMETRIC: no profile point rises above the direct ray (raw FindHorizons
// returns the full path length from both ends). ITM's propagation mode is not used for this: its
// LOS mode means d < d_sML from effective heights, which can hold on paths a ridge blocks
// (decisions.md PC12). ITM's mode is reported alongside.
// Always computed from the ACTUAL antenna heights, also when ITM ran at clutter reference heights (A.9).
import type { EngineWasm } from './wasm.ts';
import { PropagationMode } from './ntia.ts';

export type AngleBasis = 'direct' | 'horizon' | 'horizon-troposcatter';

export interface PointingAngles {
  /** Elevation angle at A toward B (rad, positive up). */
  a_rad: number;
  /** Elevation angle at B toward A (rad). */
  b_rad: number;
  basis: AngleBasis;
  label: string;
  /** No terrain above the direct ray (actual heights, ITM curvature). */
  geometricLineOfSight: boolean;
  /** Distances from each terminal to its terrain horizon (m); equal to the path length when clear. */
  horizonDistance_m: [number, number];
  /** Troposcatter: the antenna-gain term carries a wider uncertainty band. */
  widenedUncertainty: boolean;
}

/** Direct elevation angles between terminals (TN101 Eq 6.15 as in FindHorizons.cpp). */
export function directAngles(zA_m: number, zB_m: number, d_m: number, a_e_m: number): [number, number] {
  return [(zB_m - zA_m) / d_m - d_m / (2 * a_e_m), -(zB_m - zA_m) / d_m - d_m / (2 * a_e_m)];
}

export function pointingAngles(args: {
  wasm: EngineWasm;
  /** ITM propagation mode of the result whose loss is reported. */
  mode: number;
  pfl: Float64Array;
  a_e_m: number;
  hA_actual_m: number;
  hB_actual_m: number;
}): PointingAngles {
  const np = args.pfl[0] as number;
  const d = np * (args.pfl[1] as number);
  const raw = args.wasm.findHorizons(args.pfl, args.a_e_m, args.hA_actual_m, args.hB_actual_m);
  const clear = raw.d_m[0] >= d && raw.d_m[1] >= d;
  const common = { geometricLineOfSight: clear, horizonDistance_m: raw.d_m };
  if (clear) {
    const zA = (args.pfl[2] as number) + args.hA_actual_m;
    const zB = (args.pfl[np + 2] as number) + args.hB_actual_m;
    const [a, b] = directAngles(zA, zB, d, args.a_e_m);
    return { ...common, a_rad: a, b_rad: b, basis: 'direct', label: 'gain at the direct terminal-to-terminal elevation angle', widenedUncertainty: false };
  }
  if (args.mode === PropagationMode.TROPOSCATTER) {
    return {
      ...common, a_rad: raw.theta[0], b_rad: raw.theta[1], basis: 'horizon-troposcatter',
      label: 'troposcatter: one angle and one pattern value do not describe the coupling; gain at the horizon angle, wider uncertainty',
      widenedUncertainty: true,
    };
  }
  return { ...common, a_rad: raw.theta[0], b_rad: raw.theta[1], basis: 'horizon', label: 'gain toward the dominant obstacle (approximation)', widenedUncertainty: false };
}
