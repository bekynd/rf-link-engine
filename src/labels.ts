// Result labels defined by the plan; no other probability/confidence/"reliability" wording (plan 12.1).
import status from './validation-status.json' with { type: 'json' };
import { VariabilityMode } from './ntia.ts';
import type { Environment } from './environment.ts';

export const LABEL_UNVALIDATED = 'unvalidated, experimental model';
export const LABEL_COMBINED_EXPERIMENTAL = 'combined model: experimental';
export const LABEL_BARE_EARTH = 'bare earth: terrain only (optimistic baseline)';
export const LABEL_MOSAIC = 'terrain mosaic: possible source-boundary artifacts';
export const LABEL_LONG_TERM =
  'percentages describe long-term (hourly-median) statistics, not short-term fading; they are not the probability that a conversation or packet succeeds';

export interface VariabilityColumn {
  time: number;
  location: number;
  situation: number;
}

/** Plan A.5 default: broadcast mode, two columns labeled only by their exact percentages. */
export const DEFAULT_VARIABILITY = {
  mode: VariabilityMode.BROADCAST,
  columns: [
    { time: 50, location: 50, situation: 50 },
    { time: 90, location: 50, situation: 90 },
  ],
} as const;

export function columnLabel(mode: number, c: VariabilityColumn): string {
  const t = `${c.time}% time`;
  const l = `${c.location}% locations`;
  const s = `${c.situation}% situations`;
  switch (mode % 10) {
    case VariabilityMode.SINGLE_MESSAGE:
      return `${s} (single-message mode: time and location are replaced by situation)`;
    case VariabilityMode.ACCIDENTAL:
      return `${t}, ${s} (accidental mode: location is replaced by situation)`;
    case VariabilityMode.MOBILE:
      return `${t}, ${s} (mobile mode: location is replaced by time)`;
    default: {
      const median = c.time === 50 && c.location === 50 && c.situation === 50;
      return `${t}, ${l}, ${s}${median ? ' (median)' : ''}`;
    }
  }
}

/** Band/environment validation-status labels (plan 16.4, A.9 step 7; status from validation-status.json). */
export function qualityLabels(env: Environment, cell?: string): string[] {
  const s = (cell && (status.cells as Record<string, { model?: string; combinedModel?: string }>)[cell]) || status.default;
  const out: string[] = [];
  if ((s.model ?? status.default.model) === 'unvalidated') out.push(LABEL_UNVALIDATED);
  if (env.option === 'A') out.push(LABEL_BARE_EARTH);
  if (env.option === 'B' && (s.combinedModel ?? status.default.combinedModel) === 'experimental') out.push(LABEL_COMBINED_EXPERIMENTAL);
  return out;
}
