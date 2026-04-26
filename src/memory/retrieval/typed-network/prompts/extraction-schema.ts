/**
 * @file extraction-schema.ts
 * @description Zod schema for parsing the LLM's structured-output
 * response in the typed-network extraction pipeline. Mirrors
 * {@link TypedFact} fields but uses snake_case for the LLM API
 * boundary (LLMs tend to emit snake_case more reliably than
 * camelCase). The {@link TypedNetworkObserver} translates from this
 * schema's snake_case shape to the camelCase TypedFact at construction
 * time.
 *
 * **Tolerance design (Phase 4c smoke fix):** the schema accepts the
 * common deviations gpt-5-mini emits at scale, rather than throwing on
 * any deviation:
 *
 * - `bank` is preprocessed to uppercase before enum validation. The
 *   prompt asks for uppercase; if the model emits lowercase, the
 *   coercion recovers the fact instead of dropping it.
 * - `temporal.mention` is optional and defaults to empty string. The
 *   model sometimes omits it when it cannot infer a mention timestamp.
 *   Downstream {@link rankByTemporalOverlap} already handles empty
 *   mentions gracefully (falls back to interval endpoints).
 * - `temporal` itself defaults to `{mention: ''}`. The model sometimes
 *   omits the temporal block entirely on non-temporal facts.
 * - `participants`, `reasoning_markers`, `entities` default to `[]`.
 *   The model frequently emits the fact without these keys when no
 *   participants/entities/markers apply.
 *
 * Per-fact failures (text below minimum length, bank not in W/E/O/S
 * after uppercase coercion, confidence outside [0, 1]) still cause the
 * INDIVIDUAL fact to drop. The {@link TypedNetworkObserver} validates
 * facts one by one (`safeParse` per fact) and keeps the valid ones.
 *
 * @module @framers/agentos/memory/retrieval/typed-network/prompts/extraction-schema
 */

import { z } from 'zod';

/**
 * Schema for one extracted fact, matching the LLM's expected output.
 *
 * Defaults applied when the LLM omits fields:
 * - `temporal.mention`: `''` (downstream tolerates empty mention)
 * - `participants`: `[]`
 * - `reasoning_markers`: `[]`
 * - `entities`: `[]`
 * - `confidence`: `1.0`
 *
 * `bank` is uppercase-coerced before enum validation so a lowercase
 * model output (e.g. `'world'`) passes as `'WORLD'`.
 */
export const TypedExtractionFactSchema = z.object({
  text: z.string().min(1),
  bank: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION']),
  ),
  temporal: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      mention: z.string().optional().default(''),
    })
    .default({ mention: '' }),
  participants: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().default(''),
      }),
    )
    .default([]),
  reasoning_markers: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1.0),
});

/**
 * Top-level schema. Wraps the fact array under a `facts` key so the
 * LLM has a stable structural anchor to emit against. The
 * {@link TypedNetworkObserver} additionally tolerates a top-level
 * array (no `facts` key) by auto-wrapping it before this schema runs.
 */
export const TypedExtractionSchema = z.object({
  facts: z.array(TypedExtractionFactSchema),
});

/** TypeScript type inferred from {@link TypedExtractionSchema}. */
export type TypedExtractionOutput = z.infer<typeof TypedExtractionSchema>;
/** Per-fact type inferred from {@link TypedExtractionFactSchema}. */
export type TypedExtractionFact = z.infer<typeof TypedExtractionFactSchema>;
