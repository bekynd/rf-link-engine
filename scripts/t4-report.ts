// Ticket T4 reference report (plan A.9 step 6): on ≥ 30 synthetic and real profiles per clutter
// type, compute and store ITM(R) + A_h − ITM(h) and report median, spread and sign counts.
// NO assertion on the sign. For open/rural and water/sea, where the application applies no
// correction, the P.2108 Eq. 2b counterfactual is reported (decisions.md PC8).
// Usage: node scripts/t4-report.ts  → build/reports/t4-reference.{md,json}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLUTTER_CODE, ClutterTypeName, defaultTerminalClutter } from '../src/environment.ts';
import { MODEL_BUILD } from '../src/model-build.ts';
import { resampleUniform, toPfl, type UniformProfile } from '../src/profile.ts';
import { loadEngineWasm } from '../src/wasm.ts';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasm = await loadEngineWasm();

// --- reference set: 12 real public-place profiles + 20 synthetic ---
const real = JSON.parse(fs.readFileSync(path.join(pkg, 'test', 'fixtures', 'reference-profiles.json'), 'utf8')) as {
  profiles: Array<{ a: { name: string }; b: { name: string }; distances_m: number[]; elevations_m: number[] }>;
};
const profiles: Array<{ name: string; u: UniformProfile }> = real.profiles.map((p) => ({
  name: `${p.a.name} → ${p.b.name}`,
  u: resampleUniform({ distances_m: p.distances_m, elevations_m: p.elevations_m }),
}));
const synth = (name: string, L: number, f: (x: number) => number) =>
  profiles.push({ name, u: { spacing_m: L / 400, elevations_m: Array.from({ length: 401 }, (_, i) => f(i / 400)) } });
for (const L of [800, 3000, 10000, 30000]) {
  synth(`flat ${L / 1000} km`, L, () => 100);
  synth(`single hill 80 m, ${L / 1000} km`, L, (x) => 100 + 80 * Math.exp(-(((x - 0.5) / 0.08) ** 2)));
  synth(`ridge 250 m near A, ${L / 1000} km`, L, (x) => 100 + 250 * Math.exp(-(((x - 0.25) / 0.04) ** 2)));
  synth(`rolling 40 m, ${L / 1000} km`, L, (x) => 100 + 20 * (Math.sin(9 * x) + Math.sin(23 * x + 1)));
  synth(`slope A high 200 m, ${L / 1000} km`, L, (x) => 300 - 200 * x);
}

const BANDS = [50.1, 146, 223.5, 446, 868, 915, 1270];
const HEIGHTS = [1.5, 2, 5];
const B_HEIGHT = 10; // terminal B: open/rural at 10 m (no correction), so only A varies

const quant = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return (s[lo]! + (s[hi]! - s[lo]!) * (i - lo));
};

interface Row { type: string; f_mhz: number; n: number; excluded: number; median: number; p10: number; p90: number; min: number; max: number; positive: number; negative: number; zero: number; applied: boolean; continuityStep_db: number }
const rows: Row[] = [];
const raw: Record<string, number[]> = {};
for (const type of ClutterTypeName.options) {
  const tc = defaultTerminalClutter(type);
  const open = type === 'open-rural' || type === 'water-sea';
  for (const f of BANDS) {
    const diffs: number[] = [];
    let excluded = 0;
    for (const { u } of profiles) {
      const pfl = toPfl(u);
      for (const h of HEIGHTS) {
        const call = { pfl, climate: 5, N_0: 301, f_mhz: f, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, time: 50, location: 50, situation: 50, h_rx_m: B_HEIGHT };
        const atH = wasm.itmP2P({ ...call, h_tx_m: h });
        const atR = wasm.itmP2P({ ...call, h_tx_m: tc.R_m });
        const Ah = wasm.p2108HeightGain(f / 1000, h, tc.streetWidth_m, tc.R_m, CLUTTER_CODE[type]);
        if (atH.rtn > 1 || atR.rtn > 1 || Ah.rtn !== 0) { excluded++; continue; }
        diffs.push(atR.A_db + Ah.A_h_db - atH.A_db);
      }
    }
    raw[`${type}@${f}`] = diffs;
    const step = wasm.p2108HeightGain(f / 1000, tc.R_m - 1e-6, tc.streetWidth_m, tc.R_m, CLUTTER_CODE[type]).A_h_db;
    rows.push({
      type, f_mhz: f, n: diffs.length, excluded,
      median: quant(diffs, 0.5), p10: quant(diffs, 0.1), p90: quant(diffs, 0.9), min: Math.min(...diffs), max: Math.max(...diffs),
      positive: diffs.filter((d) => d > 1e-9).length, negative: diffs.filter((d) => d < -1e-9).length, zero: diffs.filter((d) => Math.abs(d) <= 1e-9).length,
      applied: !open, continuityStep_db: step,
    });
  }
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const md = [
  '# T4 reference report: ITM(R) + A_h − ITM(h)',
  '',
  `Generated ${new Date().toISOString()} by packages/engine/scripts/t4-report.ts (CI artifact). Model build: ITM ${MODEL_BUILD.itm.commit.slice(0, 7)}, P.2108 ${MODEL_BUILD.p2108.version} (${MODEL_BUILD.recommendations.P2108}).`,
  '',
  `Reference set: ${profiles.length} profiles (${real.profiles.length} real between public places, ${profiles.length - real.profiles.length} synthetic) × terminal A heights ${HEIGHTS.join(', ')} m; terminal B open/rural at ${B_HEIGHT} m. Median column (50/50/50, broadcast). P.2108-1 Table 3 default R, street width 27 m.`,
  '',
  'The difference is **recorded and investigated, not enforced** in either direction (plan A.9 step 6a). For open/rural and water/sea the application applies **no** correction (A.9 step 4); the column shows what P.2108 Eq. 2b would add (the counterfactual), so the choice is quantified. "Step at h = R" is A_h(R − 1e-6 m).',
  '',
  '| Clutter type | f (MHz) | applied? | n | median (dB) | p10 | p90 | min | max | +/−/0 | step at h = R (dB) |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.type} | ${r.f_mhz} | ${r.applied ? 'yes' : 'no (counterfactual)'} | ${r.n}${r.excluded ? ` (+${r.excluded} excl.)` : ''} | ${fmt(r.median)} | ${fmt(r.p10)} | ${fmt(r.p90)} | ${fmt(r.min)} | ${fmt(r.max)} | ${r.positive}/${r.negative}/${r.zero} | ${r.continuityStep_db.toExponential(2)} |`),
  '',
];
fs.mkdirSync(path.join(pkg, 'build', 'reports'), { recursive: true });
fs.writeFileSync(path.join(pkg, 'build', 'reports', 't4-reference.md'), md.join('\n'));
fs.writeFileSync(path.join(pkg, 'build', 'reports', 't4-reference.json'), JSON.stringify({ generated: new Date().toISOString(), profiles: profiles.map((p) => p.name), heights: HEIGHTS, rows, raw }));
console.log(md.slice(0, 9).join('\n'));
console.log(`rows: ${rows.length}; profiles per type: ${profiles.length}`);
