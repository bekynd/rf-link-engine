// Environment options (plan 4.3). Each option corrects ONCE; options are never combined at one
// terminal. The enum carries all four options from phase 1 (rework guard, plan 3) even though C and
// D are implemented in phase 10.
import { z } from 'zod';
import { P2108Clutter, P2108_DEFAULT_R, P2108_DEFAULT_STREET_WIDTH } from './ntia.ts';
import { Provenance } from './provenance.ts';

export const ClutterTypeName = z.enum(['water-sea', 'open-rural', 'suburban', 'urban', 'trees-forest', 'dense-urban']);
export type ClutterTypeName = z.infer<typeof ClutterTypeName>;

export const CLUTTER_CODE: Readonly<Record<ClutterTypeName, P2108Clutter>> = {
  'water-sea': P2108Clutter.WATER_SEA,
  'open-rural': P2108Clutter.OPEN_RURAL,
  suburban: P2108Clutter.SUBURBAN,
  urban: P2108Clutter.URBAN,
  'trees-forest': P2108Clutter.TREES_FOREST,
  'dense-urban': P2108Clutter.DENSE_URBAN,
};

export const TerminalClutter = z.object({
  type: ClutterTypeName,
  /** Representative clutter height R (m), editable (P.2108-1 Table 3 default otherwise). */
  R_m: z.number().positive(),
  streetWidth_m: z.number().positive(),
  provenance: Provenance,
});
export type TerminalClutter = z.infer<typeof TerminalClutter>;

export const Environment = z.discriminatedUnion('option', [
  /** A. Bare earth: terrain only, optimistic baseline (labeled). */
  z.object({ option: z.literal('A') }),
  /** B. Terminal clutter: P.2108 §3.1 with the A.9 reference-height recipe. Default from phase 2. */
  z.object({ option: z.literal('B'), a: TerminalClutter, b: TerminalClutter }),
  /** C. Surface-model profile (phase 10). */
  z.object({ option: z.literal('C'), surface: z.object({ dataset: z.string(), excludeTerminalCells: z.literal(true) }) }),
  /** D. Through-vegetation path, P.833-10 §2.1 / §3.1 (phase 10). */
  z.object({ option: z.literal('D'), woodlandDepth_m: z.number().nonnegative() }),
]);
export type Environment = z.infer<typeof Environment>;

export function defaultTerminalClutter(type: ClutterTypeName, date = '2026-10-24'): TerminalClutter {
  return {
    type,
    R_m: P2108_DEFAULT_R[CLUTTER_CODE[type]],
    streetWidth_m: P2108_DEFAULT_STREET_WIDTH,
    provenance: { status: 'model-default', source: 'ITU-R P.2108-1 Tables 2-3 defaults ("where local information is not available")', date },
  };
}
