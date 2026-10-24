// Link budget, one direction (plan A.1, 4.4):
//   P_rx = P_tx − L_tx,feed − L_tx,comp + G_tx(θ,φ) − L_path − L_env
//          + G_rx(θ,φ) − L_rx,feed − L_rx,comp − L_pol − L_body/vehicle/enclosure
//   Margin = P_rx − S_rx;  EIRP = P_tx − L_tx,feed − L_tx,comp + G_tx (dBi);  ERP = EIRP − 2.15 dB
// A transmitter may give ERP instead of power + gains; the engine uses whichever is supplied,
// never both. Each line carries provenance so the UI can show it on hover (plan 12.1).
import type { Provenance } from './provenance.ts';

export const DIPOLE_DBI = 2.15;

export interface Loss {
  name: string;
  db: number;
  provenance?: Provenance;
}

export interface BodyLoss extends Loss {
  /** e.g. 'body' | 'vehicle' | 'building' | 'enclosure'. */
  kind: string;
}

export type TransmitterPower =
  | { kind: 'conducted'; power_dbm: number; provenance?: Provenance }
  | { kind: 'erp'; erp_dbm: number; provenance?: Provenance };

export interface Transmitter {
  power: TransmitterPower;
  feedLoss_db: number;
  components: readonly Loss[];
  /** Antenna gain toward the path (dBi), from the pattern at the mode-dependent angle (4.1). Ignored with ERP. */
  antennaGain_dbi: number;
  /** Effects already included in the antenna's gain figure (e.g. on-body measurement). */
  gainIncludes: readonly string[];
  bodyLosses: readonly BodyLoss[];
}

export interface Receiver {
  feedLoss_db: number;
  components: readonly Loss[];
  antennaGain_dbi: number;
  gainIncludes: readonly string[];
  bodyLosses: readonly BodyLoss[];
  /** Threshold (dBm) for the chosen mode/criterion, e.g. 12 dB SINAD or LoRa SF/BW/CR (A.2). */
  sensitivity_dbm: number;
  /** Receiver desensitization allowance (dB), mainly repeaters. */
  desense_db?: number;
}

export interface BudgetLine {
  term: string;
  /** Signed contribution to P_rx (dB or dBm for the first line). */
  value: number;
  provenance?: Provenance;
  note?: string;
}

export interface BudgetResult {
  lines: BudgetLine[];
  eirp_dbm: number;
  erp_dbm: number;
  rxPower_dbm: number;
  threshold_dbm: number;
  margin_db: number;
}

export interface PathTerms {
  /** ITM loss (dB) at the heights ITM was given. */
  path_db: number;
  pathLabel: string;
  /** Environment corrections (dB), one per terminal for option B. */
  env: ReadonlyArray<{ db: number; label: string }>;
  polarizationMismatch_db?: number;
}

function bodyLines(side: 'TX' | 'RX', losses: readonly BodyLoss[], includes: readonly string[]): BudgetLine[] {
  return losses.map((l) => {
    const skipped = includes.includes(l.kind);
    const line: BudgetLine = { term: `${side} ${l.name}`, value: skipped ? 0 : -l.db };
    if (l.provenance) line.provenance = l.provenance;
    if (skipped) line.note = `skipped: antenna gain already includes ${l.kind} effects`;
    return line;
  });
}

const withProv = (line: BudgetLine, p: Provenance | undefined): BudgetLine => (p ? { ...line, provenance: p } : line);

export function linkBudget(tx: Transmitter, path: PathTerms, rx: Receiver): BudgetResult {
  const lines: BudgetLine[] = [];
  let eirp: number;
  if (tx.power.kind === 'conducted') {
    lines.push(withProv({ term: 'TX conducted power', value: tx.power.power_dbm }, tx.power.provenance));
    lines.push({ term: 'TX feedline', value: -tx.feedLoss_db });
    for (const c of tx.components) lines.push(withProv({ term: `TX ${c.name}`, value: -c.db }, c.provenance));
    lines.push({ term: 'TX antenna gain toward path', value: tx.antennaGain_dbi });
    eirp = tx.power.power_dbm - tx.feedLoss_db - tx.components.reduce((s, c) => s + c.db, 0) + tx.antennaGain_dbi;
  } else {
    eirp = tx.power.erp_dbm + DIPOLE_DBI;
    lines.push(withProv({ term: 'TX EIRP (from stated ERP + 2.15 dB)', value: eirp, note: 'ERP supplied: power, feedline and antenna gain not applied separately' }, tx.power.provenance));
  }
  lines.push(...bodyLines('TX', tx.bodyLosses, tx.gainIncludes));
  lines.push({ term: path.pathLabel, value: -path.path_db });
  for (const e of path.env) lines.push({ term: e.label, value: -e.db });
  lines.push({ term: 'RX antenna gain toward path', value: rx.antennaGain_dbi });
  lines.push({ term: 'RX feedline', value: -rx.feedLoss_db });
  for (const c of rx.components) lines.push(withProv({ term: `RX ${c.name}`, value: -c.db }, c.provenance));
  if (path.polarizationMismatch_db) lines.push({ term: 'polarization mismatch', value: -path.polarizationMismatch_db });
  lines.push(...bodyLines('RX', rx.bodyLosses, rx.gainIncludes));

  const rxPower = lines.reduce((s, l) => s + l.value, 0);
  const threshold = rx.sensitivity_dbm + (rx.desense_db ?? 0);
  return { lines, eirp_dbm: eirp, erp_dbm: eirp - DIPOLE_DBI, rxPower_dbm: rxPower, threshold_dbm: threshold, margin_db: rxPower - threshold };
}

/** Planning-heuristic bands (plan 5.1), labeled as such in the UI. */
export function marginBand(margin_db: number): 'comfortable' | 'marginal' | 'below threshold' {
  if (margin_db >= 10) return 'comfortable';
  if (margin_db >= 0) return 'marginal';
  return 'below threshold';
}
export const MARGIN_BAND_NOTE = 'planning heuristic: about ≥ +10 dB comfortable, 0 to +10 dB marginal, < 0 dB below threshold';
