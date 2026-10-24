// First Fresnel zone and clearance (plan A.6). Geometry uses the ITM-consistent effective earth
// radius (A.4). This is a display and "what would it take" aid, never mixed into ITM's loss.
import { earthBulge_m } from './refractivity.ts';
import type { UniformProfile } from './profile.ts';

/** r₁ (m) = 17.32·√(d₁·d₂ / (f_GHz·d)), distances in km. */
export function firstFresnelRadius_m(d1_m: number, d2_m: number, f_mhz: number): number {
  const d = d1_m + d2_m;
  if (d1_m <= 0 || d2_m <= 0) return 0;
  return 17.32 * Math.sqrt(((d1_m / 1000) * (d2_m / 1000)) / ((f_mhz / 1000) * (d / 1000)));
}

export interface ClearancePoint {
  index: number;
  distance_m: number;
  /** Terrain plus earth bulge (m). */
  terrain_m: number;
  /** Direct-line height (m). */
  line_m: number;
  r1_m: number;
  /** clearance / r₁ (negative = obstructed). */
  ratio: number;
}

export interface ClearanceAnalysis {
  /** The sample with the smallest clearance/r₁ ratio. */
  controlling: ClearancePoint | null;
  obstructed: boolean;
  /** Antenna height increase at A (only) to reach 0.6·r₁ everywhere (m, 0 if already met). */
  extraHeightA_m: number;
  /** Same for B. */
  extraHeightB_m: number;
  /** Same increase at both ends (lifts the line uniformly): never more than either single-end value. */
  extraHeightBoth_m: number;
  points: ClearancePoint[];
}

export function clearance(
  profile: UniformProfile,
  hA_agl_m: number,
  hB_agl_m: number,
  f_mhz: number,
  a_e_m: number,
): ClearanceAnalysis {
  const e = profile.elevations_m;
  const n = e.length - 1;
  const d = n * profile.spacing_m;
  const zA = (e[0] as number) + hA_agl_m;
  const zB = (e[n] as number) + hB_agl_m;
  const points: ClearancePoint[] = [];
  let controlling: ClearancePoint | null = null;
  let needA = 0;
  let needB = 0;
  let needBoth = 0;
  for (let i = 1; i < n; i++) {
    const x = i * profile.spacing_m;
    const terrain = (e[i] as number) + earthBulge_m(x, d, a_e_m);
    const line = zA + ((zB - zA) * x) / d;
    const r1 = firstFresnelRadius_m(x, d - x, f_mhz);
    const c = line - terrain;
    const pt: ClearancePoint = { index: i, distance_m: x, terrain_m: terrain, line_m: line, r1_m: r1, ratio: c / r1 };
    points.push(pt);
    if (!controlling || pt.ratio < controlling.ratio) controlling = pt;
    const deficit = 0.6 * r1 - c;
    if (deficit > 0) {
      // Raising A by Δ lifts the line at x by Δ·(1 − x/d); raising B lifts it by Δ·x/d.
      needA = Math.max(needA, deficit / (1 - x / d));
      needB = Math.max(needB, deficit / (x / d));
      needBoth = Math.max(needBoth, deficit);
    }
  }
  return { controlling, obstructed: points.some((p) => p.ratio < 0), extraHeightA_m: needA, extraHeightB_m: needB, extraHeightBoth_m: needBoth, points };
}
