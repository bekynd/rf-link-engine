// Ticket T1 acceptance: canonical serialization and the single-definition rule.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, inputsHash, profileSha256, type CanonicalInputs } from '../src/canonical.ts';
import { MODEL_BUILD } from '../src/model-build.ts';
import { flat } from './helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

async function sample(): Promise<CanonicalInputs> {
  const u = flat(5000, 50);
  return {
    schema: 'rflp.canonical-inputs/1',
    endpoints: { a: { lat: 36.0617, lon: -112.1081 }, b: { lat: 36.0441, lon: -111.826 } },
    profile: { intervals: 50, spacing_m: 100, sha256: await profileSha256(u) },
    frequency_mhz: 915,
    heights: { a: { actual_m: 2, itm_m: 10 }, b: { actual_m: 12, itm_m: 12 } },
    polarization: 1,
    climate: 5,
    ground: { epsilon: 15, sigma: 0.005 },
    N_0: 301,
    environment: { option: 'B', a: { type: 'suburban', R_m: 10, streetWidth_m: 27 }, b: { type: 'open-rural', R_m: 10, streetWidth_m: 27 } },
    landCover: { dataset: 'NLCD', version: 'Annual NLCD C1.2 2025', classes: { a: '22', b: '81' } },
    variability: { mode: 3, columns: [{ time: 50, location: 50, situation: 50 }, { time: 90, location: 50, situation: 90 }] },
    modelBuild: { engine: MODEL_BUILD.engine, itmCommit: MODEL_BUILD.itm.commit, p2108Commit: MODEL_BUILD.p2108.commit, recommendations: { ...MODEL_BUILD.recommendations }, emscripten: MODEL_BUILD.emscripten },
    terrain: { dataset: 'aws-terrain-tiles-terrarium', zoom: 14 },
  };
}

function shuffleKeys(v: unknown, seed = 7): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, seed + 1));
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).reverse();
    return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x, seed + 1)]));
  }
  return v;
}

describe('T1 canonical inputs', () => {
  it('canonical JSON sorts keys and normalises -0', () => {
    expect(canonicalJson({ b: 1, a: [-0, 0.1, 1e21], c: { z: 'x', y: null } })).toBe('{"a":[0,0.1,1e+21],"b":1,"c":{"y":null,"z":"x"}}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });

  it('two semantically equal inputs (key order, -0) produce the same hash', async () => {
    const a = await sample();
    const b = shuffleKeys(a) as CanonicalInputs;
    (b.endpoints.a as { lon: number }).lon = -112.1081;
    expect(await inputsHash(b)).toBe(await inputsHash(a));
    const c = structuredClone(a);
    c.heights.a.actual_m = 2.0000001;
    expect(await inputsHash(c)).not.toBe(await inputsHash(a));
  });

  it('hash is pinned (same value is asserted in the browser test suite, phase 2)', async () => {
    // If this changes, the canonical definition changed: bump the schema version.
    expect(await inputsHash(await sample())).toMatchInlineSnapshot(`"514c2b523f443b7a43585551338ad5afe9fdd65b37e0802991f37cd2f38a6983"`);
  });

  it('unknown fields are rejected (strict schema)', async () => {
    const a = { ...(await sample()), extra: 1 } as unknown as CanonicalInputs;
    await expect(inputsHash(a)).rejects.toThrow();
  });

  it('no other code path builds a cache key or result id (grep check)', () => {
    const roots = [path.join(here, '..', 'src')];
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(n) && !p.endsWith(path.join('src', 'canonical.ts'))) {
          const s = fs.readFileSync(p, 'utf8');
          if (/subtle\.digest|createHash|cacheKey|resultId/.test(s)) offenders.push(p);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
