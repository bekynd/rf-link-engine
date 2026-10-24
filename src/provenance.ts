// Field-level provenance (plan 3): every catalog parameter, repeater field, place and override.
import { z } from 'zod';

export const ProvenanceStatus = z.enum(['source-reported', 'user-estimated', 'independently-verified', 'model-default']);
export type ProvenanceStatus = z.infer<typeof ProvenanceStatus>;

export const Provenance = z.object({
  status: ProvenanceStatus,
  /** URL or description. */
  source: z.string().min(1),
  /** ISO date the value was read or entered. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  uncertainty: z.union([z.object({ plusMinus: z.number().nonnegative() }), z.object({ min: z.number(), max: z.number() })]).optional(),
  notes: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;

/** A value with its unit and provenance; `original` keeps the source value next to an override. */
export const sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, unit: z.string(), provenance: Provenance, original: z.object({ value, provenance: Provenance }).optional() });

export const MODEL_DEFAULT = (source: string, date = '2026-10-24'): Provenance => ({ status: 'model-default', source, date });
