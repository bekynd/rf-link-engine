// CanonicalInputs (ticket T1, plan 6, 15): the ONE definition used for the cache key, the result id
// hash, change detection on reopen and the stored inputs of a result. No other code builds a key or
// id (enforced by test/canonical.test.ts). Canonical serialization: sorted keys, -0 normalised to 0,
// numbers in ECMAScript's shortest round-trip form (specified exactly by the language, so stable
// across engines), no non-finite numbers.
import { z } from 'zod';
import { ClutterTypeName } from './environment.ts';
import type { UniformProfile } from './profile.ts';

const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
const TerminalHeights = z.object({ actual_m: z.number(), itm_m: z.number() }).strict();
const ClutterParams = z.object({ type: ClutterTypeName, R_m: z.number().positive(), streetWidth_m: z.number().positive() }).strict();

/** Environment parameters that affect the calculation (provenance is stored, not hashed). */
export const EnvironmentParams = z.discriminatedUnion('option', [
  z.object({ option: z.literal('A') }).strict(),
  z.object({ option: z.literal('B'), a: ClutterParams, b: ClutterParams }).strict(),
  z.object({ option: z.literal('C'), surface: z.object({ dataset: z.string(), excludeTerminalCells: z.literal(true) }).strict() }).strict(),
  z.object({ option: z.literal('D'), woodlandDepth_m: z.number().nonnegative() }).strict(),
]);

export const CanonicalInputs = z.object({
  schema: z.literal('rflp.canonical-inputs/1'),
  endpoints: z.object({ a: LatLon, b: LatLon }).strict(),
  /** The resampled profile ITM received: its content hash here, the profile itself stored alongside. */
  profile: z.object({ intervals: z.number().int().positive(), spacing_m: z.number().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  frequency_mhz: z.number().positive(),
  heights: z.object({ a: TerminalHeights, b: TerminalHeights }).strict(),
  polarization: z.number().int(),
  climate: z.number().int(),
  ground: z.object({ epsilon: z.number(), sigma: z.number() }).strict(),
  N_0: z.number(),
  environment: EnvironmentParams,
  landCover: z.object({ dataset: z.string(), version: z.string(), classes: z.object({ a: z.string(), b: z.string() }).strict() }).strict().nullable(),
  variability: z.object({
    mode: z.number().int(),
    columns: z.array(z.object({ time: z.number(), location: z.number(), situation: z.number() }).strict()).min(1),
  }).strict(),
  modelBuild: z.object({
    engine: z.string(),
    itmCommit: z.string(),
    p2108Commit: z.string(),
    recommendations: z.record(z.string(), z.string()),
    emscripten: z.string(),
  }).strict(),
  terrain: z.object({ dataset: z.string(), zoom: z.number().int() }).strict(),
}).strict();
export type CanonicalInputs = z.infer<typeof CanonicalInputs>;

const ModelBuild = CanonicalInputs.shape.modelBuild;

/**
 * Coverage inputs (plan 6: "cache key = the canonical input definition of section 15"). One
 * transmitter, a receiver height and clutter policy, the radial sampling, one variability column.
 * `terrain.profilesSha256` is null for the request key (before terrain is fetched) and the hash of
 * all radial profiles for the result id.
 */
export const CoverageCanonicalInputs = z.object({
  schema: z.literal('rflp.canonical-coverage/1'),
  center: LatLon,
  radius_m: z.number().positive(),
  /** First-pass bearings (request key) or all bearings after refinement (result id); refinement bound. */
  sampling: z.object({ bearings_deg: z.array(z.number()).min(1), step_m: z.number().positive(), maxRadials: z.number().int().positive().optional() }).strict(),
  frequency_mhz: z.number().positive(),
  heights: z.object({ tx: TerminalHeights, rx_m: z.number() }).strict(),
  polarization: z.number().int(),
  climate: z.number().int(),
  ground: z.object({ epsilon: z.number(), sigma: z.number() }).strict(),
  N_0: z.number(),
  environment: z.discriminatedUnion('option', [
    z.object({ option: z.literal('A') }).strict(),
    z.object({
      option: z.literal('B'),
      tx: ClutterParams,
      rx: z.object({ source: z.enum(['land-cover', 'fixed']), types: z.array(ClutterParams).min(1), fallback: ClutterTypeName }).strict(),
    }).strict(),
  ]),
  landCover: z.object({ dataset: z.string(), version: z.string(), resolution_m: z.number().positive(), windowCells: z.number().int().positive() }).strict().nullable(),
  variability: z.object({ mode: z.number().int(), column: z.object({ time: z.number(), location: z.number(), situation: z.number() }).strict() }).strict(),
  modelBuild: ModelBuild,
  terrain: z.object({ dataset: z.string(), zoom: z.number().int(), profilesSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable() }).strict(),
}).strict();
export type CoverageCanonicalInputs = z.infer<typeof CoverageCanonicalInputs>;

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical inputs');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`unsupported value in canonical inputs: ${typeof value}`);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto exists only in secure contexts (https, localhost); plain-http pages (e.g. a phone
  // testing over the LAN) use the FIPS 180-4 implementation below, which gives the same digest.
  const digest = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) : sha256(bytes);
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4), used only where Web Crypto is unavailable. */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(4 * i, h[i]!);
  return out;
}

/** SHA-256 of [intervals, spacing, e_0 … e_n] as little-endian IEEE-754 doubles (-0 normalised). */
export function profileSha256(u: UniformProfile): Promise<string> {
  const n = u.elevations_m.length - 1;
  const view = new DataView(new ArrayBuffer((n + 3) * 8));
  const put = (i: number, v: number) => view.setFloat64(i * 8, Object.is(v, -0) ? 0 : v, true);
  put(0, n);
  put(1, u.spacing_m);
  u.elevations_m.forEach((e, i) => put(i + 2, e));
  return sha256Hex(new Uint8Array(view.buffer));
}

/** SHA-256 of a sequence of uniform profiles (coverage radials), each hashed as in profileSha256. */
export async function profilesSha256(us: readonly UniformProfile[]): Promise<string> {
  const each = await Promise.all(us.map(profileSha256));
  return sha256Hex(new TextEncoder().encode(each.join(',')));
}

/** The cache key, result id and change-detection hash: one function, one definition. */
export async function inputsHash(inputs: CanonicalInputs | CoverageCanonicalInputs): Promise<string> {
  const parsed = inputs.schema === 'rflp.canonical-coverage/1' ? CoverageCanonicalInputs.parse(inputs) : CanonicalInputs.parse(inputs);
  return sha256Hex(new TextEncoder().encode(canonicalJson(parsed)));
}
