/**
 * @fileoverview Validated LLM invoker wrapper with Zod schema validation and retry.
 *
 * Wraps any `(systemPrompt, userPrompt) => Promise<string>` LLM invoker function
 * with automatic JSON extraction, Zod validation, and retry-with-feedback on failure.
 *
 * Pipeline:
 * 1. Call LLM via the raw invoker
 * 2. Extract JSON from response via `extractJson()` (handles markdown fences, thinking blocks, JSONL)
 * 3. Parse with `JSON.parse`
 * 4. Validate with Zod `.safeParse()` (applies defaults, type coercion)
 * 5. If valid: return typed result
 * 6. If invalid: retry with error feedback + optional schema description
 * 7. If all retries fail: throw `LlmOutputValidationError` with full history
 *
 * @module agentos/core/validation/ValidatedLlmInvoker
 */
import { ZodError } from 'zod';
import { extractJson } from './extractJson.js';
import { LlmOutputValidationError } from './errors.js';
// ── Implementation ───────────────────────────────────────────────────────
/**
 * Create a validated LLM invoker that returns typed, Zod-validated results.
 *
 * Wraps a raw LLM invoker function with:
 * 1. JSON extraction from messy LLM output (markdown fences, thinking blocks, etc.)
 * 2. Zod `.safeParse()` validation with full type inference
 * 3. Retry with error feedback + schema description on failure
 * 4. `LlmOutputValidationError` with retry history when all attempts fail
 *
 * @param invoker - Raw LLM invoker function `(system, user) => Promise<string>`
 * @param schema - Zod schema to validate the extracted JSON against
 * @param options - Retry count, schema injection, structured output preference
 * @returns A function with the same `(system, user)` signature that returns `z.infer<T>`
 *
 * @example
 * ```ts
 * const validated = createValidatedInvoker(llmInvoker, PersonalitySchema);
 * const personality = await validated(systemPrompt, userPrompt);
 * // personality is typed as z.infer<typeof PersonalitySchema>
 * ```
 *
 * @example
 * ```ts
 * // With retry configuration
 * const validated = createValidatedInvoker(invoker, Schema, {
 *   maxRetries: 2,
 *   injectSchemaOnRetry: true,
 * });
 * ```
 */
export function createValidatedInvoker(invoker, schema, options) {
    const maxRetries = options?.maxRetries ?? 1;
    const injectSchema = options?.injectSchemaOnRetry ?? true;
    // Pre-compute a human-readable schema description for retry prompts.
    // This is injected into the retry system prompt so the LLM knows
    // exactly what JSON shape is expected on the next attempt.
    const schemaDescription = describeSchema(schema);
    return async (systemPrompt, userPrompt) => {
        const retryHistory = [];
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // On retries, append error feedback from the previous attempt
            // so the LLM can correct its output. This dramatically improves
            // success rates — most LLMs fix their JSON when told what's wrong.
            let effectiveSystem = systemPrompt;
            if (attempt > 0 && retryHistory.length > 0) {
                const lastError = retryHistory[retryHistory.length - 1];
                effectiveSystem = systemPrompt + '\n\n' +
                    `IMPORTANT: Your previous response was not valid. Error: ${lastError.error}\n` +
                    `Please output ONLY valid JSON matching the required format.` +
                    (injectSchema ? `\n\nRequired JSON format:\n${schemaDescription}` : '');
            }
            // Call the LLM
            const rawOutput = await invoker(effectiveSystem, userPrompt);
            // Extract JSON from the raw output using centralized extraction
            const jsonStr = extractJson(rawOutput);
            if (!jsonStr) {
                retryHistory.push({
                    attempt,
                    rawOutput,
                    error: 'No JSON found in LLM output',
                });
                continue;
            }
            // Parse JSON
            let parsed;
            try {
                parsed = JSON.parse(jsonStr);
            }
            catch (parseErr) {
                retryHistory.push({
                    attempt,
                    rawOutput,
                    error: `JSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
                });
                continue;
            }
            // Validate with Zod — safeParse applies defaults and type coercion
            const result = schema.safeParse(parsed);
            if (result.success) {
                return result.data;
            }
            // Validation failed — record the Zod error details for retry feedback
            retryHistory.push({
                attempt,
                rawOutput,
                error: `Zod validation: ${(result.error.issues ?? []).map((e) => `${(e.path ?? []).join('.')}: ${e.message}`).join('; ')}`,
            });
        }
        // All attempts exhausted — throw with full history for debugging.
        // The error includes the raw output and Zod errors from the final
        // attempt, plus the complete retry history.
        const lastRaw = retryHistory[retryHistory.length - 1]?.rawOutput ?? '';
        // Build a ZodError from the final attempt's validation.
        // Try to re-parse so we get the actual Zod errors from the last attempt.
        let finalZodError;
        const finalJsonStr = extractJson(lastRaw);
        if (finalJsonStr) {
            try {
                const finalParsed = JSON.parse(finalJsonStr);
                const finalResult = schema.safeParse(finalParsed);
                finalZodError = finalResult.success
                    ? new ZodError([])
                    : finalResult.error;
            }
            catch {
                finalZodError = new ZodError([]);
            }
        }
        else {
            finalZodError = new ZodError([]);
        }
        throw new LlmOutputValidationError(`LLM output validation failed after ${maxRetries} retries: ${retryHistory[retryHistory.length - 1]?.error ?? 'Unknown error'}`, lastRaw, finalZodError, maxRetries, retryHistory);
    };
}
/**
 * Generate a human-readable description of a Zod schema for injection
 * into retry prompts. The LLM sees this and knows what JSON shape to produce.
 *
 * Uses `zod-to-json-schema` when available for accurate conversion.
 * Falls back to a simple string representation when the library is
 * not installed (non-critical — retry still works with error feedback alone).
 *
 * @param schema - Zod schema to describe
 * @returns Multi-line string describing the expected JSON structure
 */
function describeSchema(schema) {
    // Extract field names from Zod shape for a human-readable description.
    // Zod v4 stores shape as a plain object on `_def.shape`.
    // Zod v3 stores it as a function `_def.shape()`.
    try {
        const rawShape = schema._def?.shape;
        const shape = typeof rawShape === 'function' ? rawShape() : rawShape;
        if (shape && typeof shape === 'object') {
            const fields = Object.keys(shape).join(', ');
            return `A JSON object with these fields: ${fields}`;
        }
    }
    catch {
        // Ignore shape extraction failure
    }
    // Try zod-to-json-schema for complex schemas (optional dependency)
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const zodToJsonSchema = require('zod-to-json-schema').zodToJsonSchema; // Dynamic optional dep
        const jsonSchema = zodToJsonSchema(schema);
        const str = JSON.stringify(jsonSchema, null, 2);
        // zod-to-json-schema may return {} for Zod v4 — check for useful content
        if (str.length > 10)
            return str;
    }
    catch {
        // Not available — use field-name fallback above
    }
    return 'A valid JSON object matching the required schema';
}
//# sourceMappingURL=ValidatedLlmInvoker.js.map