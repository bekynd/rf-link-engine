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
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
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

/** The cache key, result id and change-detection hash: one function, one definition. */
export async function inputsHash(inputs: CanonicalInputs): Promise<string> {
  const parsed = CanonicalInputs.parse(inputs);
  return sha256Hex(new TextEncoder().encode(canonicalJson(parsed)));
}
