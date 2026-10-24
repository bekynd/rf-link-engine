// Unit tests for every equation in plan Appendix A (A.1-A.6; A.9 in clutter.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { DIPOLE_DBI, linkBudget, marginBand, type Receiver, type Transmitter } from '../src/budget.ts';
import { clearance, firstFresnelRadius_m } from '../src/fresnel.ts';
import { columnLabel, DEFAULT_VARIABILITY } from '../src/labels.ts';
import { VariabilityMode } from '../src/ntia.ts';
import { predictPathLoss } from '../src/path.ts';
import { toPfl } from '../src/profile.ts';
import { deriveRefractivity, effectiveEarthRadius_m, hSys, surfaceRefractivity } from '../src/refractivity.ts';
import { dbmToMicrovolts, loraAirtime_s, loraSensitivityFormula_dbm, microvoltsToDbm } from '../src/thresholds.ts';
import { checkItmParams, hasError, pathLabels } from '../src/validity.ts';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { flat, hill, request, synth } from './helpers.ts';

let wasm: EngineWasm;
beforeAll(async () => { wasm = await loadEngineWasm(); });

describe('A.1 link budget', () => {
  const tx: Transmitter = {
    power: { kind: 'conducted', power_dbm: 22 }, feedLoss_db: 0.28, components: [{ name: 'connector', db: 0.2 }],
    antennaGain_dbi: 5.8, gainIncludes: [], bodyLosses: [],
  };
  const rx: Receiver = {
    feedLoss_db: 0, components: [], antennaGain_dbi: 2, gainIncludes: ['body'],
    bodyLosses: [{ kind: 'body', name: 'on-body loss', db: 6 }], sensitivity_dbm: -131.5,
  };
  const path = { path_db: 130, pathLabel: 'ITM basic transmission loss', env: [{ db: 12.3, label: 'P.2108 terminal correction A_h (B)' }], polarizationMismatch_db: 1 };

  it('sums every term with the right sign', () => {
    const r = linkBudget(tx, path, rx);
    const expected = 22 - 0.28 - 0.2 + 5.8 - 130 - 12.3 + 2 - 0 - 1; // body skipped
    expect(r.rxPower_dbm).toBeCloseTo(expected, 12);
    expect(r.margin_db).toBeCloseTo(expected + 131.5, 12);
    expect(r.eirp_dbm).toBeCloseTo(22 - 0.28 - 0.2 + 5.8, 12);
    expect(r.erp_dbm).toBeCloseTo(r.eirp_dbm - DIPOLE_DBI, 12);
  });

  it('skips a body loss when the antenna gain already includes it', () => {
    const line = linkBudget(tx, path, rx).lines.find((l) => l.term.includes('on-body'));
    expect(line?.value).toBe(0);
    expect(line?.note).toMatch(/already includes body/);
    const r2 = linkBudget(tx, path, { ...rx, gainIncludes: [] });
    expect(r2.rxPower_dbm).toBeCloseTo(linkBudget(tx, path, rx).rxPower_dbm - 6, 12);
  });

  it('uses ERP when supplied and never also the power and gain terms', () => {
    const erp = linkBudget({ ...tx, power: { kind: 'erp', erp_dbm: 40 } }, path, rx);
    expect(erp.eirp_dbm).toBeCloseTo(42.15, 12);
    expect(erp.lines.some((l) => l.term === 'TX antenna gain toward path' || l.term === 'TX feedline')).toBe(false);
    expect(erp.rxPower_dbm).toBeCloseTo(42.15 - 130 - 12.3 + 2 - 1, 12);
  });

  it('receiver desensitization raises the threshold; bands are the planning heuristics', () => {
    expect(linkBudget(tx, path, { ...rx, desense_db: 3 }).threshold_dbm).toBe(-128.5);
    expect(marginBand(10)).toBe('comfortable');
    expect(marginBand(0)).toBe('marginal');
    expect(marginBand(-0.01)).toBe('below threshold');
  });
});

describe('A.2 receiver thresholds', () => {
  it('FM µV to dBm across 50 Ω', () => {
    expect(microvoltsToDbm(0.16)).toBeCloseTo(-122.918, 3); // typical 2 m handheld spec, 12 dB SINAD
    expect(microvoltsToDbm(1)).toBe(-107);
    expect(dbmToMicrovolts(microvoltsToDbm(0.18))).toBeCloseTo(0.18, 12);
  });

  it('LoRa formula: LONG_FAST (SF11, 250 kHz) ≈ −131.5 dBm', () => {
    expect(loraSensitivityFormula_dbm(11, 250e3)).toBeCloseTo(-131.52, 2);
    // Datasheet cross-check: SX1262 SF12/125 kHz table value −137 dBm
    expect(loraSensitivityFormula_dbm(12, 125e3)).toBeCloseTo(-137.03, 2);
  });

  it('LoRa airtime (SX126x §6.1.4): LONG_FAST, 10-byte payload, 16-symbol preamble', () => {
    const t = loraAirtime_s({ sf: 11, bw_hz: 250e3, cr: 1, payloadBytes: 10, preambleSymbols: 16 });
    expect(t).toBeCloseTo((16 + 4.25) * 0.008192 + 18 * 0.008192, 12); // 313.344 ms
  });
});

describe('A.3 two-tier validity', () => {
  const ok = { f_mhz: 915, h_tx_m: 2, h_rx_m: 10, N_0: 301, climate: 5, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, time: 50, location: 50, situation: 50 };
  const zone = (o: Partial<typeof ok>) => {
    const i = checkItmParams({ ...ok, ...o });
    return hasError(i) ? 'error' : i.length ? 'warning' : 'ok';
  };
  it('frequency, heights, N0 zones match NTIA', () => {
    expect(zone({})).toBe('ok');
    expect(zone({ f_mhz: 30 })).toBe('warning');
    expect(zone({ f_mhz: 15 })).toBe('error');
    expect(zone({ f_mhz: 12000 })).toBe('warning');
    expect(zone({ f_mhz: 21000 })).toBe('error');
    expect(zone({ h_tx_m: 0.7 })).toBe('warning');
    expect(zone({ h_tx_m: 0.4 })).toBe('error');
    expect(zone({ h_rx_m: 2000 })).toBe('warning');
    expect(zone({ h_rx_m: 3100 })).toBe('error');
    expect(zone({ N_0: 249 })).toBe('error');
    expect(zone({ N_0: 400 })).toBe('ok');
  });
  it('other library errors and the wrapper epsilon rule (PC2, PC11)', () => {
    expect(zone({ epsilon: 0.9 })).toBe('error');
    expect(zone({ epsilon: 1 })).toBe('error');
    expect(zone({ sigma: 0 })).toBe('error');
    expect(zone({ climate: 8 })).toBe('error');
    expect(zone({ mdvar: 4 })).toBe('error');
    expect(zone({ mdvar: 13 })).toBe('ok');
    expect(zone({ time: 0 })).toBe('error');
    expect(zone({ situation: 100 })).toBe('error');
  });
  it('short paths compute with the extrapolated label; no model switch at 1 km', () => {
    expect(pathLabels(999, 0).map((i) => i.code)).toContain('EXTRAPOLATED');
    expect(pathLabels(1000, 0).map((i) => i.code)).not.toContain('EXTRAPOLATED');
    const short = predictPathLoss(wasm, request(flat(400, 40)));
    expect(short.status).toBe('ok');
    expect(short.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['EXTRAPOLATED', 'PATH_DISTANCE_TOO_SMALL_2']));
    // continuity across 1 km: same model both sides
    const a = predictPathLoss(wasm, request(flat(999, 100))).columns[0]!.totalLoss_db;
    const b = predictPathLoss(wasm, request(flat(1001, 100))).columns[0]!.totalLoss_db;
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });
});

describe('A.4 refractivity and curvature', () => {
  it('Nₛ = N₀·exp(−h_sys/9460); N₀ = 301 at sea level gives ≈ 4/3 earth', () => {
    expect(surfaceRefractivity(301, 0)).toBe(301);
    expect(surfaceRefractivity(301, 1000)).toBeCloseTo(301 * Math.exp(-1000 / 9460), 12);
    expect(effectiveEarthRadius_m(301) / 6370e3).toBeCloseTo(4 / 3, 2);
  });

  it("h_sys excludes the first and last 10 % (PC1) and our Nₛ equals ITM's exactly", () => {
    const u = synth(20000, 100, (x) => (x <= 0.1 || x >= 0.9 ? 1000 : 200)); // whole-path mean would be 352.5
    expect(hSys(toPfl(u))).toBe((79 * 200 + 2 * 1000) / 81); // ITM window: indices 10..90 (81 points), two at 1000 m
    for (const prof of [u, hill(30000, 400), flat(8000, 80, 1500)]) {
      const r = predictPathLoss(wasm, request(prof));
      const itm = wasm.itmP2P({ h_tx_m: 2, h_rx_m: 10, pfl: toPfl(prof), climate: 5, N_0: 301, f_mhz: 915, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, time: 50, location: 50, situation: 50 });
      expect(r.refractivity!.N_s).toBe(itm.N_s);
      expect(deriveRefractivity(301, toPfl(prof)).N_s).toBe(itm.N_s);
    }
  });
});

describe('A.5 variability', () => {
  it('default is broadcast with the two exact-percentage columns', () => {
    expect(DEFAULT_VARIABILITY.mode).toBe(VariabilityMode.BROADCAST);
    const labels = DEFAULT_VARIABILITY.columns.map((c) => columnLabel(3, c));
    expect(labels).toEqual(['50% time, 50% locations, 50% situations (median)', '90% time, 50% locations, 90% situations']);
    for (const l of labels) expect(l).not.toMatch(/reliab|probab|confiden/i);
  });

  it('library combination rules (Variability.cpp): single message replaces time and location by situation', () => {
    const pfl = toPfl(hill(40000, 300));
    const run = (mdvar: number, time: number, location: number, situation: number) =>
      wasm.itmP2P({ h_tx_m: 10, h_rx_m: 10, pfl, climate: 5, N_0: 301, f_mhz: 146, pol: 1, epsilon: 15, sigma: 0.005, mdvar, time, location, situation }).A_db;
    expect(run(0, 10, 90, 70)).toBe(run(0, 50, 20, 70)); // single message: only situation matters
    expect(run(1, 30, 10, 70)).toBe(run(1, 30, 90, 70)); // accidental: location replaced by situation
    expect(run(2, 30, 10, 70)).toBe(run(2, 30, 90, 70)); // mobile: location replaced by time
    expect(run(3, 30, 10, 70)).not.toBe(run(3, 30, 90, 70)); // broadcast: all independent
    const single = predictPathLoss(wasm, request(hill(40000, 300), { variability: { mode: 0, columns: [{ time: 50, location: 50, situation: 90 }] } }));
    expect(single.columns).toHaveLength(1);
    expect(single.columns[0]!.label).toBe('90% situations (single-message mode: time and location are replaced by situation)');
  });
});

describe('A.6 Fresnel zone', () => {
  it('r₁ = 17.32·√(d₁d₂/(f_GHz·d))', () => {
    expect(firstFresnelRadius_m(5000, 5000, 915)).toBeCloseTo(17.32 * Math.sqrt(25 / (0.915 * 10)), 12);
    expect(firstFresnelRadius_m(0, 5000, 915)).toBe(0);
  });

  it('height needed at A to clear 0.6·r₁ at the controlling obstacle is sufficient and minimal', () => {
    const u = hill(10000, 60, 400, 100);
    const a_e = effectiveEarthRadius_m(301);
    const c = clearance(u, 2, 10, 915, a_e);
    expect(c.obstructed).toBe(true);
    expect(c.controlling!.distance_m).toBeCloseTo(5000, -2);
    const raised = clearance(u, 2 + c.extraHeightA_m, 10, 915, a_e);
    expect(raised.controlling!.ratio).toBeGreaterThanOrEqual(0.6 - 1e-9);
    const almost = clearance(u, 2 + c.extraHeightA_m - 0.01, 10, 915, a_e);
    expect(almost.controlling!.ratio).toBeLessThan(0.6);
  });
});
