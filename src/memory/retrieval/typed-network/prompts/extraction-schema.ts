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
 * @module @framers/agentos/memory/retrieval/typed-network/prompts/extraction-schema
 */

import { z } from 'zod';

/**
 * Schema for one extracted fact, matching the LLM's expected output.
 * `confidence` defaults to 1.0 when missing — the schema permits
 * omission for non-Opinion facts where the value is structurally 1.0.
 */
export const TypedExtractionFactSchema = z.object({
  text: z.string().min(1),
  bank: z.enum(['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION']),
  temporal: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    mention: z.string(),
  }),
  participants: z.array(
    z.object({ name: z.string(), role: z.string() }),
  ),
  reasoning_markers: z.array(z.string()),
  entities: z.array(z.string()),
  confidence: z.number().min(0).max(1).default(1.0),
});

/**
 * Top-level schema. Wraps the fact array under a `facts` key so the
 * LLM has a stable structural anchor to emit against.
 */
export const TypedExtractionSchema = z.object({
  facts: z.array(TypedExtractionFactSchema),
});

/** TypeScript type inferred from {@link TypedExtractionSchema}. */
export type TypedExtractionOutput = z.infer<typeof TypedExtractionSchema>;
/** Per-fact type inferred from {@link TypedExtractionFactSchema}. */
export type TypedExtractionFact = z.infer<typeof TypedExtractionFactSchema>;
