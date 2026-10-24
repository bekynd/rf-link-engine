// Constants mirrored from NTIA ITM (include/Enums.h, Errors.h, Warnings.h) and NTIA P.2108
// (include/P2108.h) at the pinned commits (decisions.md §2). Names follow NTIA's.

export const Climate = {
  EQUATORIAL: 1,
  CONTINENTAL_SUBTROPICAL: 2,
  MARITIME_SUBTROPICAL: 3,
  DESERT: 4,
  CONTINENTAL_TEMPERATE: 5,
  MARITIME_TEMPERATE_OVER_LAND: 6,
  MARITIME_TEMPERATE_OVER_SEA: 7,
} as const;
export type Climate = (typeof Climate)[keyof typeof Climate];

export const Polarization = { HORIZONTAL: 0, VERTICAL: 1 } as const;
export type Polarization = (typeof Polarization)[keyof typeof Polarization];

/** ITM mode of variability (plan A.5). +10 / +20 flags are not used by default. */
export const VariabilityMode = { SINGLE_MESSAGE: 0, ACCIDENTAL: 1, MOBILE: 2, BROADCAST: 3 } as const;
export type VariabilityMode = (typeof VariabilityMode)[keyof typeof VariabilityMode];

/** ITM propagation mode returned in IntermediateValues.mode. */
export const PropagationMode = { NOT_SET: 0, LINE_OF_SIGHT: 1, DIFFRACTION: 2, TROPOSCATTER: 3 } as const;
export type PropagationMode = (typeof PropagationMode)[keyof typeof PropagationMode];

export const ITM_SUCCESS = 0;
export const ITM_SUCCESS_WITH_WARNINGS = 1;

/** ITM warning flags (Warnings.h) with NTIA's descriptions. */
export const ITM_WARNINGS: ReadonlyArray<{ bit: number; code: string; message: string }> = [
  { bit: 0x0001, code: 'TX_TERMINAL_HEIGHT', message: 'TX terminal height is near its limits' },
  { bit: 0x0002, code: 'RX_TERMINAL_HEIGHT', message: 'RX terminal height is near its limits' },
  { bit: 0x0004, code: 'FREQUENCY', message: 'Frequency is near its limits' },
  { bit: 0x0008, code: 'PATH_DISTANCE_TOO_BIG_1', message: 'Path distance is near its upper limit' },
  { bit: 0x0010, code: 'PATH_DISTANCE_TOO_BIG_2', message: 'Path distance is large - care must be taken with result' },
  { bit: 0x0020, code: 'PATH_DISTANCE_TOO_SMALL_1', message: 'Path distance is near its lower limit' },
  { bit: 0x0040, code: 'PATH_DISTANCE_TOO_SMALL_2', message: 'Path distance is small - care must be taken with result' },
  { bit: 0x0080, code: 'TX_HORIZON_ANGLE', message: 'TX horizon angle is large - small angle approximations could break down' },
  { bit: 0x0100, code: 'RX_HORIZON_ANGLE', message: 'RX horizon angle is large - small angle approximations could break down' },
  { bit: 0x0200, code: 'TX_HORIZON_DISTANCE_1', message: 'TX horizon distance is less than 1/10 of the smooth earth horizon distance' },
  { bit: 0x0400, code: 'RX_HORIZON_DISTANCE_1', message: 'RX horizon distance is less than 1/10 of the smooth earth horizon distance' },
  { bit: 0x0800, code: 'TX_HORIZON_DISTANCE_2', message: 'TX horizon distance is greater than 3 times the smooth earth horizon distance' },
  { bit: 0x1000, code: 'RX_HORIZON_DISTANCE_2', message: 'RX horizon distance is greater than 3 times the smooth earth horizon distance' },
  { bit: 0x2000, code: 'EXTREME_VARIABILITIES', message: 'One of the provided variabilities is located far in the tail of its distribution' },
  { bit: 0x4000, code: 'SURFACE_REFRACTIVITY', message: 'Internally computed surface refractivity value is small - care must be taken with result' },
];

/** ITM error codes (Errors.h). */
export const ITM_ERRORS: Readonly<Record<number, string>> = {
  1000: 'TX terminal height is out of range',
  1001: 'RX terminal height is out of range',
  1002: 'Invalid value for radio climate',
  1003: 'Time percentage is out of range',
  1004: 'Location percentage is out of range',
  1005: 'Situation percentage is out of range',
  1006: 'Confidence percentage is out of range',
  1007: 'Reliability percentage is out of range',
  1008: 'Refractivity is out of range',
  1009: 'Frequency is out of range',
  1010: 'Invalid value for polarization',
  1011: 'Epsilon is out of range',
  1012: 'Sigma is out of range',
  1013: 'The imaginary portion of the complex impedance is larger than the real portion',
  1014: 'Invalid value for mode of variability',
  1016: 'Internally computed effective earth radius is invalid',
  1017: 'Path distance is out of range',
  1018: 'Delta H (terrain irregularity parameter) is out of range',
  1019: 'Invalid value for TX siting criteria',
  1020: 'Invalid value for RX siting criteria',
  1021: 'Internally computed surface refractivity value is too small',
  1022: 'Internally computed surface refractivity value is too large',
};

export function decodeItmWarnings(mask: number): Array<{ code: string; message: string }> {
  return ITM_WARNINGS.filter((w) => (mask & w.bit) !== 0).map(({ code, message }) => ({ code, message }));
}

/** P.2108 clutter types (Table 3) as NTIA numbers them. */
export const P2108Clutter = {
  WATER_SEA: 1,
  OPEN_RURAL: 2,
  SUBURBAN: 3,
  URBAN: 4,
  TREES_FOREST: 5,
  DENSE_URBAN: 6,
} as const;
export type P2108Clutter = (typeof P2108Clutter)[keyof typeof P2108Clutter];

/** P.2108-1 Table 3 default representative clutter heights R (m), "where local information is not available". */
export const P2108_DEFAULT_R: Readonly<Record<P2108Clutter, number>> = {
  1: 10, 2: 10, 3: 10, 4: 15, 5: 15, 6: 20,
};
/** P.2108-1 Table 2 default street width (m). */
export const P2108_DEFAULT_STREET_WIDTH = 27;

/** P.2108 return codes (P2108.h). Header comments for 3.1/3.2 frequency are stale; ranges here are the code's. */
export const P2108_ERRORS: Readonly<Record<number, string>> = {
  32: 'Frequency must be between 0.03 and 3 GHz (section 3.1)',
  33: 'Antenna height must be > 0 m (section 3.1)',
  34: 'Street width must be > 0 m (section 3.1)',
  35: 'Representative clutter height must be > 0 m (section 3.1)',
  36: 'Invalid value for clutter type (section 3.1)',
  48: 'Frequency must be between 0.5 and 67 GHz (section 3.2)',
  49: 'Path distance must be >= 0.25 km (section 3.2)',
  50: 'Percentage must be between 0 and 100 (section 3.2)',
};
