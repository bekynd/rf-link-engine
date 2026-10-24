// Antenna gain toward the path (plan 4.4). Parametric pattern: parabolic attenuation in each plane
// (−12·(Δ/θ3dB)² dB, the form used by ITU-R F.1336 / 3GPP TR 36.814 sector models), limited by a
// side-lobe floor and the front-to-back ratio. Pattern files (ADF/MSI) come later (catalog phase).

export interface AntennaPattern {
  /** Peak gain (dBi), a sourced estimate (catalog provenance). */
  gain_dbi: number;
  /** Vertical 3 dB beamwidth, full width (deg). Undefined = no vertical directivity modeled. */
  verticalBeamwidth_deg?: number;
  /** Horizontal 3 dB beamwidth (deg). Undefined = omnidirectional in azimuth. */
  azimuthBeamwidth_deg?: number;
  /** Front-to-back ratio (dB), directional antennas. */
  frontToBack_db?: number;
  /** Maximum attenuation off the main lobe in the vertical plane (dB, positive). Default 20. */
  verticalFloor_db?: number;
}

export interface AntennaOrientation {
  /** Boresight azimuth (deg true). Ignored for omni patterns. */
  azimuth_deg?: number;
  /** Mechanical downtilt (deg, positive = below horizon). */
  downtilt_deg?: number;
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * Gain (dBi) toward a direction given by elevation angle (rad, positive above horizontal) and
 * azimuth (deg true).
 */
export function gainToward(p: AntennaPattern, o: AntennaOrientation, elevation_rad: number, azimuth_deg: number): number {
  let g = p.gain_dbi;
  if (p.verticalBeamwidth_deg !== undefined) {
    const elevDeg = (elevation_rad * 180) / Math.PI;
    const off = elevDeg + (o.downtilt_deg ?? 0); // boresight points downtilt below horizontal
    g -= Math.min(12 * (off / p.verticalBeamwidth_deg) ** 2, p.verticalFloor_db ?? 20);
  }
  if (p.azimuthBeamwidth_deg !== undefined) {
    const off = wrap180(azimuth_deg - (o.azimuth_deg ?? 0));
    g -= Math.min(12 * (off / p.azimuthBeamwidth_deg) ** 2, p.frontToBack_db ?? 25);
  }
  return g;
}

/** Initial great-circle bearing (deg true) from a to b. */
export function bearing_deg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const φ1 = a.lat * r;
  const φ2 = b.lat * r;
  const Δλ = (b.lon - a.lon) * r;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
