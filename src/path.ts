// Path loss for one frequency on one profile: validation, environment option, ITM per labeled
// variability column, pointing angles and labels. Budget-only changes reuse this result
// (reciprocity of path loss at one frequency, plan 6); duplex repeaters call it once per frequency (4.5).
import { pointingAngles, type PointingAngles } from './angles.ts';
import { terminalClutter, type TerminalClutterResult } from './clutter.ts';
import type { Environment } from './environment.ts';
import { columnLabel, qualityLabels, type VariabilityColumn } from './labels.ts';
import { ITM_ERRORS, ITM_SUCCESS_WITH_WARNINGS } from './ntia.ts';
import { GeometryError, profileLength_m, toPfl, type UniformProfile } from './profile.ts';
import { deriveRefractivity, type DerivedRefractivity } from './refractivity.ts';
import { checkItmParams, hasError, pathLabels, type ValidityIssue } from './validity.ts';
import type { EngineWasm } from './wasm.ts';

export interface PathRequest {
  /** Uniform profile from A (index 0) to B. */
  profile: UniformProfile;
  f_mhz: number;
  /** Actual antenna heights above ground (m). */
  heights: { a_m: number; b_m: number };
  environment: Environment;
  climate: number;
  N_0: number;
  polarization: number;
  ground: { epsilon: number; sigma: number };
  variability: { mode: number; columns: readonly VariabilityColumn[] };
  /** Set when the two terminals have identical coordinates (checked by the caller from lat/lon). */
  coincidentTerminals?: boolean;
  /** (band, environment) validation cell, e.g. "915|suburban". */
  validationCell?: string;
}

export interface PathLossColumn extends VariabilityColumn {
  label: string;
  /** ITM basic transmission loss at the ITM heights (dB). */
  itmLoss_db: number;
  /** Environment correction added (dB): sum of terminal corrections for option B. */
  envCorrection_db: number;
  totalLoss_db: number;
  warnings: number;
  mode: number;
}

export interface PathLossResult {
  status: 'ok' | 'unsupported';
  issues: ValidityIssue[];
  labels: string[];
  columns: PathLossColumn[];
  /** The profile ITM received (stored with results, plan 15). */
  profile: UniformProfile;
  length_m: number;
  itmHeights: { a_m: number; b_m: number };
  terminals: { a: TerminalClutterResult; b: TerminalClutterResult } | null;
  refractivity: DerivedRefractivity | null;
  itm: { theta_hzn: [number, number]; d_hzn_m: [number, number]; h_e_m: [number, number]; delta_h_m: number; mode: number } | null;
  angles: PointingAngles | null;
}

function unsupported(req: PathRequest, issues: ValidityIssue[], extra: Partial<PathLossResult> = {}): PathLossResult {
  return {
    status: 'unsupported', issues, labels: [], columns: [], profile: req.profile, length_m: safeLength(req.profile),
    itmHeights: { a_m: req.heights.a_m, b_m: req.heights.b_m }, terminals: null, refractivity: null, itm: null, angles: null, ...extra,
  };
}
const safeLength = (u: UniformProfile) => (Number.isFinite(u.spacing_m) ? profileLength_m(u) : Number.NaN);

export function predictPathLoss(wasm: EngineWasm, req: PathRequest): PathLossResult {
  if (req.coincidentTerminals) {
    return unsupported(req, [{ zone: 'error', code: 'COINCIDENT_TERMINALS', message: 'the two terminals are at the same location', source: 'wrapper' }]);
  }
  let pfl: Float64Array;
  try {
    pfl = toPfl(req.profile);
  } catch (e) {
    if (e instanceof GeometryError) return unsupported(req, [{ zone: 'error', code: e.code, message: e.message, source: 'wrapper' }]);
    throw e;
  }
  const length = profileLength_m(req.profile);
  if (!(length > 0)) return unsupported(req, [{ zone: 'error', code: 'ZERO_LENGTH', message: 'path length is zero', source: 'wrapper' }]);
  for (const h of [req.heights.a_m, req.heights.b_m]) {
    if (!Number.isFinite(h)) return unsupported(req, [{ zone: 'error', code: 'NON_FINITE_HEIGHT', message: 'antenna height is not finite', source: 'wrapper' }]);
  }

  // Environment option: exactly one correction mechanism per terminal (plan 4.3).
  const env = req.environment;
  let terminals: PathLossResult['terminals'] = null;
  const issues: ValidityIssue[] = [];
  if (env.option === 'B') {
    terminals = {
      a: terminalClutter(wasm, env.a, req.heights.a_m, req.f_mhz),
      b: terminalClutter(wasm, env.b, req.heights.b_m, req.f_mhz),
    };
    issues.push(...terminals.a.issues, ...terminals.b.issues);
  } else if (env.option !== 'A') {
    return unsupported(req, [{ zone: 'error', code: 'ENVIRONMENT_NOT_AVAILABLE', message: `environment option ${env.option} is not available yet (phase 10)`, source: 'wrapper' }]);
  }
  const itmHeights = terminals
    ? { a_m: terminals.a.itmHeight_m, b_m: terminals.b.itmHeight_m }
    : { a_m: req.heights.a_m, b_m: req.heights.b_m };
  const envCorrection = terminals ? terminals.a.A_h_db + terminals.b.A_h_db : 0;

  const mode = req.variability.mode;
  const singleMessage = mode % 10 === 0;
  for (const c of req.variability.columns) {
    issues.push(...checkItmParams({
      f_mhz: req.f_mhz, h_tx_m: itmHeights.a_m, h_rx_m: itmHeights.b_m, N_0: req.N_0, climate: req.climate, pol: req.polarization,
      epsilon: req.ground.epsilon, sigma: req.ground.sigma, mdvar: mode,
      time: singleMessage ? c.situation : c.time, location: singleMessage ? c.situation : c.location, situation: c.situation,
    }));
  }
  const unique = dedupe(issues);
  if (hasError(unique) || req.variability.columns.length === 0) {
    if (req.variability.columns.length === 0) unique.push({ zone: 'error', code: 'NO_COLUMNS', message: 'no variability column requested', source: 'wrapper' });
    return unsupported(req, unique, { itmHeights, terminals });
  }

  const columns: PathLossColumn[] = [];
  let itm: PathLossResult['itm'] = null;
  let warningsUnion = 0;
  for (const c of req.variability.columns) {
    const time = singleMessage ? c.situation : c.time;
    const location = singleMessage ? c.situation : c.location;
    const r = wasm.itmP2P({
      h_tx_m: itmHeights.a_m, h_rx_m: itmHeights.b_m, pfl, climate: req.climate, N_0: req.N_0, f_mhz: req.f_mhz,
      pol: req.polarization, epsilon: req.ground.epsilon, sigma: req.ground.sigma, mdvar: mode, time, location, situation: c.situation,
    });
    if (r.rtn > ITM_SUCCESS_WITH_WARNINGS) {
      return unsupported(req, [...unique, { zone: 'error', code: `ITM_${r.rtn}`, message: ITM_ERRORS[r.rtn] ?? `ITM error ${r.rtn}`, source: 'NTIA ITM' }], { itmHeights, terminals });
    }
    warningsUnion |= r.warnings;
    itm ??= { theta_hzn: r.theta_hzn, d_hzn_m: r.d_hzn_m, h_e_m: r.h_e_m, delta_h_m: r.delta_h_m, mode: r.mode };
    columns.push({ ...c, time, location, label: columnLabel(mode, c), itmLoss_db: r.A_db, envCorrection_db: envCorrection, totalLoss_db: r.A_db + envCorrection, warnings: r.warnings, mode: r.mode });
  }

  const refractivity = deriveRefractivity(req.N_0, pfl);
  const angles = pointingAngles({ wasm, mode: itm!.mode, pfl, a_e_m: refractivity.a_e_m, hA_actual_m: req.heights.a_m, hB_actual_m: req.heights.b_m });
  return {
    status: 'ok',
    issues: dedupe([...unique, ...pathLabels(length, warningsUnion)]),
    labels: qualityLabels(env, req.validationCell),
    columns, profile: req.profile, length_m: length, itmHeights, terminals, refractivity, itm, angles,
  };
}

function dedupe(issues: ValidityIssue[]): ValidityIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.zone + i.code) ? false : (seen.add(i.zone + i.code), true)));
}
