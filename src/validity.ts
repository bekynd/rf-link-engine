// Two-tier validity (plan A.3): warning-zone inputs compute with a visible warning; error-zone
// inputs return "unsupported" and are never passed to ITM. Ranges are NTIA's
// (ValidateInputs.cpp, LongleyRice.cpp) except where marked "wrapper", which are this
// application's additional checks (decisions.md PC2, PC11).
import { Climate, Polarization, VariabilityMode, decodeItmWarnings } from './ntia.ts';

export interface ValidityIssue {
  zone: 'warning' | 'error';
  code: string;
  message: string;
  source: 'NTIA ITM' | 'wrapper' | 'NTIA P.2108';
}

export interface ItmParams {
  f_mhz: number;
  h_tx_m: number;
  h_rx_m: number;
  N_0: number;
  climate: number;
  pol: number;
  epsilon: number;
  sigma: number;
  mdvar: number;
  time: number;
  location: number;
  situation: number;
}

/** Wrapper limits beyond NTIA's. */
export const WRAPPER_LIMITS = {
  /**
   * Relative permittivity of ground. NTIA accepts >= 1, but at exactly 1 (horizontal
   * polarization) Re(Z_g) = |Im(Z_g)| mathematically and ITM's strict check is decided by the
   * last bit of sqrt, which differs between C libraries (found by the native-vs-WASM suite,
   * decisions.md PC11). Real ground is ~4 (poor) to 81 (sea water); air is 1.
   */
  epsilonMin: 2,
  /** Minimum profile intervals handed to ITM (wrapper choice; ITM needs points for horizons and the Δh fit). */
  minIntervals: 10,
  /** Paths shorter than this are labeled extrapolated (plan 2, 4.1). */
  extrapolatedBelowM: 1000,
} as const;

const inOpen = (x: number, lo: number, hi: number) => x > lo && x < hi;
const finite = (...xs: number[]) => xs.every(Number.isFinite);

/** Checks ITM scalar inputs before any call. Profile geometry is checked in profile.ts. */
export function checkItmParams(p: ItmParams): ValidityIssue[] {
  const out: ValidityIssue[] = [];
  const err = (code: string, message: string, source: ValidityIssue['source'] = 'NTIA ITM') => out.push({ zone: 'error', code, message, source });
  const warn = (code: string, message: string, source: ValidityIssue['source'] = 'NTIA ITM') => out.push({ zone: 'warning', code, message, source });

  if (!finite(p.f_mhz, p.h_tx_m, p.h_rx_m, p.N_0, p.epsilon, p.sigma, p.time, p.location, p.situation)) {
    err('NON_FINITE_INPUT', 'An input is not a finite number', 'wrapper');
    return out;
  }
  if (p.f_mhz < 20 || p.f_mhz > 20000) err('FREQUENCY', 'Frequency outside 20-20,000 MHz');
  else if (p.f_mhz < 40 || p.f_mhz > 10000) warn('FREQUENCY', 'Frequency outside 40-10,000 MHz');
  for (const [name, h] of [['TX', p.h_tx_m], ['RX', p.h_rx_m]] as const) {
    if (h < 0.5 || h > 3000) err(`${name}_TERMINAL_HEIGHT`, `${name} terminal height outside 0.5-3,000 m`);
    else if (h < 1 || h > 1000) warn(`${name}_TERMINAL_HEIGHT`, `${name} terminal height outside 1-1,000 m`);
  }
  if (p.N_0 < 250 || p.N_0 > 400) err('REFRACTIVITY', 'Sea-level refractivity N0 outside 250-400 N-units');
  if (!(Object.values(Climate) as number[]).includes(p.climate)) err('CLIMATE', 'Invalid radio climate');
  if (!(Object.values(Polarization) as number[]).includes(p.pol)) err('POLARIZATION', 'Invalid polarization');
  if (p.epsilon < 1) err('EPSILON', 'Relative permittivity must be >= 1');
  else if (p.epsilon < WRAPPER_LIMITS.epsilonMin) err('EPSILON_NOT_GROUND', `Relative permittivity below ${WRAPPER_LIMITS.epsilonMin} is not a ground type`, 'wrapper');
  if (p.sigma <= 0) err('SIGMA', 'Ground conductivity must be > 0');
  const base = p.mdvar % 10;
  const flags = p.mdvar - base;
  if (!Number.isInteger(p.mdvar) || ![0, 10, 20, 30].includes(flags) || !(Object.values(VariabilityMode) as number[]).includes(base)) {
    err('MDVAR', 'Invalid mode of variability');
  }
  if (!inOpen(p.time, 0, 100)) err('TIME', 'Time percentage must be strictly between 0 and 100');
  if (!inOpen(p.location, 0, 100)) err('LOCATION', 'Location percentage must be strictly between 0 and 100');
  if (!inOpen(p.situation, 0, 100)) err('SITUATION', 'Situation percentage must be strictly between 0 and 100');
  return out;
}

/** Wrapper-level path labels (plan 2, 4.1, A.3). */
export function pathLabels(d_m: number, warningsMask: number): ValidityIssue[] {
  const out: ValidityIssue[] = decodeItmWarnings(warningsMask).map((w) => ({ zone: 'warning' as const, ...w, source: 'NTIA ITM' as const }));
  if (d_m < WRAPPER_LIMITS.extrapolatedBelowM) {
    out.push({
      zone: 'warning',
      code: 'EXTRAPOLATED',
      message: "extrapolated beyond the model's documented range; not yet validated",
      source: 'wrapper',
    });
  }
  return out;
}

export const hasError = (issues: readonly ValidityIssue[]) => issues.some((i) => i.zone === 'error');
