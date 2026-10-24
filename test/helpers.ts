import type { UniformProfile } from '../src/profile.ts';
import type { PathRequest } from '../src/path.ts';
import { DEFAULT_VARIABILITY } from '../src/labels.ts';
import { Climate, Polarization } from '../src/ntia.ts';

/** Uniform synthetic profile from a function of fractional distance x ∈ [0, 1]. */
export function synth(length_m: number, intervals: number, f: (x: number) => number): UniformProfile {
  return { spacing_m: length_m / intervals, elevations_m: Array.from({ length: intervals + 1 }, (_, i) => f(i / intervals)) };
}

export const flat = (length_m: number, intervals = 200, z = 100) => synth(length_m, intervals, () => z);
export const hill = (length_m: number, height_m: number, intervals = 400, base = 100) =>
  synth(length_m, intervals, (x) => base + height_m * Math.exp(-(((x - 0.5) / 0.08) ** 2)));

export function request(profile: UniformProfile, over: Partial<PathRequest> = {}): PathRequest {
  return {
    profile,
    f_mhz: 915,
    heights: { a_m: 2, b_m: 10 },
    environment: { option: 'A' },
    climate: Climate.CONTINENTAL_TEMPERATE,
    N_0: 301,
    polarization: Polarization.VERTICAL,
    ground: { epsilon: 15, sigma: 0.005 },
    variability: DEFAULT_VARIABILITY,
    ...over,
  };
}
