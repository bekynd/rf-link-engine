import { describe, expect, it } from 'vitest';
import { externalNoiseFa_db, noiseEffect, P372_MAN_MADE } from '../src/noise.ts';

describe('ITU-R P.372 man-made noise (PC5)', () => {
  it('Fam = c − d·log10(f) per Table 1; galactic floor; nothing above 250 MHz', () => {
    expect(externalNoiseFa_db('residential', 146.52)).toBeCloseTo(72.5 - 27.7 * Math.log10(146.52), 9); // ≈ 12.5 dB
    expect(externalNoiseFa_db('city', 100)).toBeCloseTo(76.8 - 55.4, 9);
    // Quiet rural at 146 MHz is below galactic noise: the galactic value is used.
    expect(externalNoiseFa_db('quiet-rural', 146.52)).toBeCloseTo(52 - 23 * Math.log10(146.52), 9);
    expect(externalNoiseFa_db('residential', 446)).toBeNull();
    expect(Object.keys(P372_MAN_MADE).sort()).toEqual(['city', 'quiet-rural', 'residential', 'rural']);
  });

  it('threshold rise = 10·log10((fa + fr − 1)/fr): residential 2 m ≈ 6.4 dB with a 7 dB receiver; ordered by environment', () => {
    const fa = 10 ** ((72.5 - 27.7 * Math.log10(146.52)) / 10), fr = 10 ** 0.7;
    expect(noiseEffect('residential', 146.52).degradation_db).toBeCloseTo(10 * Math.log10((fa + fr - 1) / fr), 9);
    expect(noiseEffect('residential', 146.52).degradation_db).toBeCloseTo(6.4, 1);
    const d = (['quiet-rural', 'rural', 'residential', 'city'] as const).map((e) => noiseEffect(e, 146.52).degradation_db);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(noiseEffect('city', 906.875)).toMatchObject({ fa_db: null, degradation_db: 0 });
    expect(noiseEffect('city', 906.875).label).toMatch(/not modelled/);
  });
});
