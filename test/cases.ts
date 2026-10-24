// Deterministic verification cases for native-vs-WASM (plan 16.1). Generated from a fixed seed so
// the native golden file (scripts/native-golden.ts) and the WASM test see identical inputs.
// Covers NTIA's own vectors, valid inputs across the whole domain, warning-zone and error-zone
// inputs (the library's return codes must match exactly too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ntiaItm = path.join(here, '..', 'third_party', 'ntia-itm');
const ntiaP2108 = path.join(here, '..', 'third_party', 'ntia-p2108', 'test-data');

export interface ItmCase {
  kind: 'itm';
  h_tx: number; h_rx: number; climate: number; N0: number; f: number; pol: number;
  eps: number; sigma: number; mdvar: number; time: number; loc: number; sit: number;
  pfl: number[];
}
export interface HgtcCase { kind: 'hgtc'; f: number; h: number; ws: number; R: number; type: number }
export interface TsmCase { kind: 'tsm'; f: number; d: number; p: number }
export interface HznCase { kind: 'hzn'; a_e: number; h_tx: number; h_rx: number; pfl: number[] }
export type Case = ItmCase | HgtcCase | TsmCase | HznCase;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthProfile(r: () => number, lengthM: number, np: number): number[] {
  const spacing = lengthM / np;
  const base = r() < 0.15 ? 0 : r() * 2500;
  const kind = Math.floor(r() * 6);
  const amp = r() * (kind === 0 ? 0 : 600);
  const phases = [r(), r(), r(), r()].map((p) => p * 2 * Math.PI);
  const e: number[] = [];
  for (let i = 0; i <= np; i++) {
    const x = i / np;
    let z = base;
    if (kind === 1) z += amp * Math.exp(-(((x - 0.5) / 0.12) ** 2)); // single hill
    if (kind === 2) z += amp * Math.exp(-(((x - (0.2 + 0.6 * phases[0]! / (2 * Math.PI))) / 0.05) ** 2)); // ridge
    if (kind === 3) z += amp * 0.5 * (Math.sin(7 * x + phases[0]!) + 0.5 * Math.sin(23 * x + phases[1]!) + 0.25 * Math.sin(61 * x + phases[2]!)); // rough
    if (kind === 4) z += amp * x; // slope
    if (kind === 5) z += amp * (1 - Math.sin(Math.PI * x)); // valley between terminals
    e.push(Math.round(z * 1000) / 1000);
  }
  return [np, spacing, ...e];
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}
const logUniform = (r: () => number, lo: number, hi: number) => lo * Math.exp(r() * Math.log(hi / lo));

function ntiaItmVectors(): ItmCase[] {
  const rows = fs.readFileSync(path.join(ntiaItm, 'p2p.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const pfls = fs.readFileSync(path.join(ntiaItm, 'pfls.csv'), 'utf8').trim().split(/\r?\n/);
  return rows.map((row, i) => {
    const v = row.split(',').map(Number);
    return {
      kind: 'itm', h_tx: v[0]!, h_rx: v[1]!, eps: v[2]!, sigma: v[3]!, N0: v[4]!, f: v[5]!, pol: v[6]!,
      climate: v[7]!, time: v[8]!, loc: v[9]!, sit: v[10]!, mdvar: v[11]!,
      pfl: pfls[i]!.split(',').map(Number),
    };
  });
}

function ntiaP2108Vectors(): Array<HgtcCase | TsmCase> {
  const read = (f: string) => fs.readFileSync(path.join(ntiaP2108, f), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(',').map(Number));
  return [
    ...read('HeightGainTerminalCorrectionModelTestData.csv').map((v): HgtcCase => ({ kind: 'hgtc', f: v[0]!, h: v[1]!, ws: v[2]!, R: v[3]!, type: v[4]! })),
    ...read('TerrestrialStatisticalModelTestData.csv').map((v): TsmCase => ({ kind: 'tsm', f: v[0]!, d: v[1]!, p: v[2]! })),
  ];
}

export function generateCases(seed = 20261024, nItm = 3000, nP2108 = 600, nHzn = 400): Case[] {
  const r = mulberry32(seed);
  const cases: Case[] = [...ntiaItmVectors(), ...ntiaP2108Vectors()];
  const mdvars = [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33] as const;

  for (let i = 0; i < nItm; i++) {
    const length = logUniform(r, 50, 400e3);
    const np = Math.max(2, Math.min(3000, Math.round(logUniform(r, 10, 3000))));
    const edge = r() < 0.08; // deliberately push one input into a warning or error zone
    const c: ItmCase = {
      kind: 'itm',
      h_tx: logUniform(r, 0.6, 900),
      h_rx: logUniform(r, 0.6, 900),
      climate: 1 + Math.floor(r() * 7),
      N0: 250 + r() * 150,
      f: logUniform(r, 25, 18000),
      pol: r() < 0.5 ? 0 : 1,
      eps: pick(r, [4, 5, 10, 15, 25, 81]),
      sigma: pick(r, [0.001, 0.002, 0.005, 0.008, 0.01, 0.03, 5]),
      mdvar: pick(r, mdvars),
      time: pick(r, [1, 10, 50, 90, 99, 0.5 + r() * 99]),
      loc: pick(r, [1, 10, 50, 90, 99, 0.5 + r() * 99]),
      sit: pick(r, [1, 10, 50, 90, 99, 0.5 + r() * 99]),
      pfl: synthProfile(r, length, np),
    };
    if (edge) {
      const which = Math.floor(r() * 9);
      if (which === 0) c.f = pick(r, [10, 21, 35, 12000, 25000]);
      if (which === 1) c.h_tx = pick(r, [0.3, 0.7, 1200, 3500]);
      if (which === 2) c.h_rx = pick(r, [0.4, 0.9, 1500, 4000]);
      if (which === 3) c.N0 = pick(r, [200, 249, 401, 450]);
      if (which === 4) c.climate = pick(r, [0, 8]);
      if (which === 5) c.mdvar = pick(r, [4, 9, 34, -1]);
      if (which === 6) c.time = pick(r, [0, 100, 0.001, 99.999]);
      if (which === 7) c.eps = pick(r, [0.5, 1]);
      if (which === 8) c.sigma = pick(r, [0, 1e-6]);
    }
    cases.push(c);
  }

  for (let i = 0; i < nP2108; i++) {
    if (r() < 0.7) {
      cases.push({
        kind: 'hgtc',
        f: r() < 0.9 ? logUniform(r, 0.03, 3) : pick(r, [0.02, 3.5]),
        h: r() < 0.95 ? r() * 30 : pick(r, [0, -1]),
        ws: r() < 0.95 ? 5 + r() * 45 : 0,
        R: r() < 0.95 ? 3 + r() * 30 : 0,
        type: r() < 0.97 ? 1 + Math.floor(r() * 6) : pick(r, [0, 7]),
      });
    } else {
      cases.push({ kind: 'tsm', f: logUniform(r, 0.3, 80), d: logUniform(r, 0.1, 100), p: r() < 0.95 ? 0.5 + r() * 99 : pick(r, [0, 100]) });
    }
  }

  for (let i = 0; i < nHzn; i++) {
    const length = logUniform(r, 200, 200e3);
    const np = Math.max(2, Math.round(logUniform(r, 10, 2000)));
    cases.push({ kind: 'hzn', a_e: 6370e3 * (1 + r()), h_tx: logUniform(r, 1, 300), h_rx: logUniform(r, 1, 300), pfl: synthProfile(r, length, np) });
  }
  return cases;
}

/** Line format read by native/harness.cpp. Numbers use JS shortest round-trip formatting. */
export function caseLine(c: Case): string {
  switch (c.kind) {
    case 'itm':
      return ['itm', c.h_tx, c.h_rx, c.climate, c.N0, c.f, c.pol, c.eps, c.sigma, c.mdvar, c.time, c.loc, c.sit, ...c.pfl].join(' ');
    case 'hgtc':
      return ['hgtc', c.f, c.h, c.ws, c.R, c.type].join(' ');
    case 'tsm':
      return ['tsm', c.f, c.d, c.p].join(' ');
    case 'hzn':
      return ['hzn', c.a_e, c.h_tx, c.h_rx, ...c.pfl].join(' ');
  }
}
