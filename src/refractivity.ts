// Refractivity and effective-earth curvature (plan 4.1, A.4), computed exactly as ITM does so that
// the profile display and the antenna geometry use the same earth as the calculation.

/**
 * h_sys as itm_p2p.cpp computes it: mean of the profile elevations excluding the first and last
 * 10 % of points (decisions.md PC1). `pfl` is NTIA's format.
 */
export function hSys(pfl: ArrayLike<number>): number {
  const np = Math.trunc(pfl[0] as number);
  const p10 = Math.trunc(0.1 * np);
  let sum = 0;
  for (let i = p10; i <= np - p10; i++) sum += pfl[i + 2] as number;
  return sum / (np - 2 * p10 + 1);
}

/** Nₛ = N₀·exp(−h_sys/9460) (TN101 Eq 4.3); Nₛ = N₀ when h_sys = 0, as in InitializePointToPoint.cpp. */
export function surfaceRefractivity(N_0: number, h_sys_m: number): number {
  return h_sys_m === 0 ? N_0 : N_0 * Math.exp(-h_sys_m / 9460);
}

/** γ_e = 157e-9·(1 − 0.04665·exp(Nₛ/179.3)) per metre (TN101 Eq 4.4, reworked). */
export function effectiveCurvature(N_s: number): number {
  return 157e-9 * (1 - 0.04665 * Math.exp(N_s / 179.3));
}

export const effectiveEarthRadius_m = (N_s: number) => 1 / effectiveCurvature(N_s);

/** Earth bulge (m) at distance x along a path of length d with effective radius a_e (display and clearance). */
export const earthBulge_m = (x_m: number, d_m: number, a_e_m: number) => (x_m * (d_m - x_m)) / (2 * a_e_m);

export interface DerivedRefractivity {
  N_0: number;
  h_sys_m: number;
  N_s: number;
  gamma_e_per_m: number;
  a_e_m: number;
}

export function deriveRefractivity(N_0: number, pfl: ArrayLike<number>): DerivedRefractivity {
  const h = hSys(pfl);
  const N_s = surfaceRefractivity(N_0, h);
  const gamma = effectiveCurvature(N_s);
  return { N_0, h_sys_m: h, N_s, gamma_e_per_m: gamma, a_e_m: 1 / gamma };
}
