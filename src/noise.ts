// Local noise (plan 4.4, decisions.md PC5): ITU-R P.372 median man-made noise, Fam = c − d·log10(f),
// in dB above kT0b, for the environment categories of P.372 (Table 1), valid 0.3-250 MHz; galactic
// noise as the floor where man-made noise is lower. Above 250 MHz the curves are not offered (PC5):
// no adjustment is made and the result says so.
//
// Effect on a receiver: a radio's sensitivity is specified with only its own noise (noise figure F).
// With external noise fa (linear) the system noise factor is f = fa + fr − 1 (P.372 §2, antenna and
// line losses neglected), so the threshold rises by 10·log10(f / fr).

export type NoiseEnvironment = 'quiet-rural' | 'rural' | 'residential' | 'city';

/** P.372 Table 1 (median man-made noise): Fam = c − d·log10(f MHz). */
export const P372_MAN_MADE: Readonly<Record<NoiseEnvironment, { c: number; d: number; label: string }>> = {
  city: { c: 76.8, d: 27.7, label: 'city (business)' },
  residential: { c: 72.5, d: 27.7, label: 'residential' },
  rural: { c: 67.2, d: 27.7, label: 'rural' },
  'quiet-rural': { c: 53.6, d: 28.6, label: 'quiet rural' },
};
/** Galactic noise, P.372: Fa = 52 − 23·log10(f MHz). */
export const P372_GALACTIC = { c: 52.0, d: 23.0 } as const;
export const P372_RANGE_MHZ = [0.3, 250] as const;
/** Assumed receiver noise figure when the radio's is unknown (labeled as a default). */
export const DEFAULT_RECEIVER_NF_DB = 7;

export interface NoiseEffect {
  /** External noise above kT0b (dB), or null when the curves do not cover the frequency. */
  fa_db: number | null;
  /** How much the receiver threshold rises (dB, ≥ 0). */
  degradation_db: number;
  label: string;
}

export function externalNoiseFa_db(env: NoiseEnvironment, f_mhz: number): number | null {
  if (f_mhz < P372_RANGE_MHZ[0] || f_mhz > P372_RANGE_MHZ[1]) return null;
  const m = P372_MAN_MADE[env];
  const manMade = m.c - m.d * Math.log10(f_mhz);
  const galactic = P372_GALACTIC.c - P372_GALACTIC.d * Math.log10(f_mhz);
  return Math.max(manMade, galactic);
}

/** Threshold rise for a receiver of noise figure nf_db in environment env (P.372 median). */
export function noiseEffect(env: NoiseEnvironment, f_mhz: number, nf_db = DEFAULT_RECEIVER_NF_DB): NoiseEffect {
  const fa = externalNoiseFa_db(env, f_mhz);
  if (fa === null) {
    return { fa_db: null, degradation_db: 0, label: `${P372_MAN_MADE[env].label} noise not modelled at ${f_mhz.toFixed(1)} MHz (ITU-R P.372 curves cover 0.3-250 MHz)` };
  }
  const fr = 10 ** (nf_db / 10);
  const degradation = Math.max(0, 10 * Math.log10((10 ** (fa / 10) + fr - 1) / fr));
  return { fa_db: fa, degradation_db: degradation, label: `${P372_MAN_MADE[env].label} noise, ITU-R P.372 median (Fa ${fa.toFixed(1)} dB; receiver noise figure ${nf_db} dB assumed)` };
}
