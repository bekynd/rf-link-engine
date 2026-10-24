// Receiver thresholds (plan A.2) and LoRa airtime (plan 5, context only; no delivery percentages, A.7).

/** FM sensitivity in µV across 50 Ω to dBm: 20·log10(µV) − 107. */
export const microvoltsToDbm = (uV: number) => 20 * Math.log10(uV) - 107;
export const dbmToMicrovolts = (dbm: number) => 10 ** ((dbm + 107) / 20);

/**
 * FM "good" threshold offset above the 12 dB SINAD ("readable") figure. No standard mapping
 * exists (decisions.md §10); one manufacturer pair gives +2.5 dB. Heuristic, user-editable.
 */
export const FM_GOOD_OFFSET_DB_DEFAULT = 3;

/** Required demodulator SNR per spreading factor (Semtech DS.SX1261-2 Rev 1.2, Table 6-1). */
export const LORA_SNR_REQUIRED_DB: Readonly<Record<number, number>> = {
  5: -2.5, 6: -5, 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20,
};

/** Generic cross-check: S = −174 + 10·log10(BW) + NF + SNR_req(SF), NF ≈ 6 dB (A.2). */
export function loraSensitivityFormula_dbm(sf: number, bw_hz: number, nf_db = 6): number {
  const snr = LORA_SNR_REQUIRED_DB[sf];
  if (snr === undefined) throw new RangeError(`unsupported spreading factor ${sf}`);
  return -174 + 10 * Math.log10(bw_hz) + nf_db + snr;
}

export interface LoraAirtimeInput {
  sf: number;
  bw_hz: number;
  /** Coding rate denominator − 4: 1 for 4/5 … 4 for 4/8. */
  cr: 1 | 2 | 3 | 4;
  payloadBytes: number;
  preambleSymbols?: number;
  explicitHeader?: boolean;
  crc?: boolean;
  /** Low data rate optimisation; default on when T_sym ≥ 16 ms (SX126x requirement). */
  lowDataRateOptimize?: boolean;
}

/** Time on air (s), Semtech SX126x datasheet §6.1.4 formula, SF7-SF12. */
export function loraAirtime_s(i: LoraAirtimeInput): number {
  if (i.sf < 7 || i.sf > 12) throw new RangeError('airtime formula implemented for SF7-SF12');
  const tSym = 2 ** i.sf / i.bw_hz;
  const de = (i.lowDataRateOptimize ?? tSym >= 0.016) ? 1 : 0;
  const ih = i.explicitHeader === false ? 1 : 0;
  const crc = i.crc === false ? 0 : 1;
  const nPre = i.preambleSymbols ?? 8;
  const num = 8 * i.payloadBytes - 4 * i.sf + 28 + 16 * crc - 20 * ih;
  const payloadSymbols = 8 + Math.max(Math.ceil(num / (4 * (i.sf - 2 * de))) * (i.cr + 4), 0);
  return (nPre + 4.25) * tSym + payloadSymbols * tSym;
}
