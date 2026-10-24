// Ticket T1 acceptance: canonical serialization and the single-definition rule.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, inputsHash, profileSha256, sha256, type CanonicalInputs } from '../src/canonical.ts';
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
    expect(await inputsHash(await sample())).toMatchInlineSnapshot(`"e015312a0152010751ec4a66303ff4a88afbcb36f7fb29afe7406b26dd91ce5e"`);
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

  it('coverage inputs hash through the same function; terrain hash and sampling change the id', async () => {
    const { MODEL_BUILD } = await import('../src/model-build.ts');
    const base = {
      schema: 'rflp.canonical-coverage/1' as const,
      center: { lat: 44.35, lon: -68.22 }, radius_m: 20000,
      sampling: { bearings_deg: [0, 90, 180, 270], step_m: 100 },
      frequency_mhz: 915, heights: { tx: { actual_m: 4, itm_m: 10 }, rx_m: 1.5 },
      polarization: 1, climate: 5, ground: { epsilon: 15, sigma: 0.005 }, N_0: 301,
      environment: { option: 'B' as const, tx: { type: 'suburban' as const, R_m: 10, streetWidth_m: 27 }, rx: { source: 'land-cover' as const, types: [{ type: 'suburban' as const, R_m: 10, streetWidth_m: 27 }], fallback: 'suburban' as const } },
      landCover: { dataset: 'ESA WorldCover', version: '10m 2021 v200', resolution_m: 20, windowCells: 5 },
      variability: { mode: 13, column: { time: 50, location: 50, situation: 50 } },
      modelBuild: { engine: MODEL_BUILD.engine, itmCommit: MODEL_BUILD.itm.commit, p2108Commit: MODEL_BUILD.p2108.commit, recommendations: { ...MODEL_BUILD.recommendations }, emscripten: MODEL_BUILD.emscripten },
      terrain: { dataset: 'aws-terrain-tiles-terrarium', zoom: 12, profilesSha256: null },
    };
    const h0 = await inputsHash(base);
    expect(h0).toMatch(/^[0-9a-f]{64}$/);
    expect(await inputsHash({ ...base, sampling: { bearings_deg: [0, 90, 180, 270, 45], step_m: 100 } })).not.toBe(h0);
    expect(await inputsHash({ ...base, terrain: { ...base.terrain, profilesSha256: 'a'.repeat(64) } })).not.toBe(h0);
    await expect(inputsHash({ ...base, extra: 1 } as unknown as typeof base)).rejects.toThrow();
  });

  it('the fallback SHA-256 (no Web Crypto on plain http) matches FIPS vectors and Web Crypto', async () => {
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const enc = (t: string) => new TextEncoder().encode(t);
    expect(hex(sha256(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    for (const n of [55, 56, 63, 64, 65, 1000, 100_003]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      expect(hex(sha256(bytes))).toBe(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
    }
  });
});
