// End-to-end over real terrain between public places (fixtures from apps/web/scripts/fetch-reference-profiles.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultTerminalClutter } from '../src/environment.ts';
import { predictPathLoss } from '../src/path.ts';
import { resampleUniform } from '../src/profile.ts';
import { loadEngineWasm, type EngineWasm } from '../src/wasm.ts';
import { request } from './helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'reference-profiles.json'), 'utf8')) as {
  profiles: Array<{ a: { name: string }; b: { name: string }; length_m: number; flags: string[]; distances_m: number[]; elevations_m: number[] }>;
};

let wasm: EngineWasm;
beforeAll(async () => { wasm = await loadEngineWasm(); });

describe('real public-place profiles', () => {
  it.each(fx.profiles.map((p) => [`${p.a.name} → ${p.b.name}`, p] as const))('%s', (_name, p) => {
    const u = resampleUniform({ distances_m: p.distances_m, elevations_m: p.elevations_m });
    for (const f of [146, 446, 915]) {
      for (const environment of [{ option: 'A' as const }, { option: 'B' as const, a: defaultTerminalClutter('suburban'), b: defaultTerminalClutter('trees-forest') }]) {
        const r = predictPathLoss(wasm, request(u, { f_mhz: f, heights: { a_m: 1.5, b_m: 6 }, environment }));
        expect(r.status).toBe('ok');
        expect(r.columns).toHaveLength(2);
        // loss not exceeded at 90% time/situations is at least the median loss
        expect(r.columns[1]!.totalLoss_db).toBeGreaterThanOrEqual(r.columns[0]!.totalLoss_db);
        expect(r.issues.some((i) => i.code === 'EXTRAPOLATED')).toBe(p.length_m < 1000);
        expect(Number.isFinite(r.angles!.a_rad)).toBe(true);
      }
    }
  });

  it('profiles that cross source datasets carry the mosaic boundary flag', () => {
    const crossing = fx.profiles.filter((p) => (p as unknown as { datasets: string[] }).datasets.length > 1);
    expect(crossing.length).toBeGreaterThan(0);
    for (const p of crossing) expect(p.flags).toContain('MOSAIC_SOURCE_BOUNDARY');
  });
});
