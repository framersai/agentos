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
import { type z } from 'zod';
/** LLM invoker function with optional capability flags. */
export interface LlmInvokerWithCapabilities {
    (systemPrompt: string, userPrompt: string): Promise<string>;
    /** Provider supports native JSON schema enforcement (Anthropic tool_use, OpenAI json_schema). */
    supportsStructuredOutput?: boolean;
    /** Provider ID for telemetry and logging. */
    providerId?: string;
}
/** Options for the validated invoker wrapper. */
export interface ValidatedInvokerOptions {
    /**
     * Maximum number of retry attempts after the initial call fails validation.
     * Each retry appends error feedback to the system prompt.
     * @default 1
     */
    maxRetries?: number;
    /**
     * Whether to inject the JSON Schema description into the retry prompt
     * so the LLM knows exactly what shape is expected.
     * @default true
     */
    injectSchemaOnRetry?: boolean;
    /**
     * Whether to prefer provider-native structured output when available.
     * When true and the invoker has `supportsStructuredOutput: true`, the
     * Zod schema is converted to JSON Schema and passed to the provider.
     * @default true
     */
    preferStructuredOutput?: boolean;
}
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
export declare function createValidatedInvoker<T extends z.ZodType>(invoker: LlmInvokerWithCapabilities | ((s: string, u: string) => Promise<string>), schema: T, options?: ValidatedInvokerOptions): (systemPrompt: string, userPrompt: string) => Promise<z.infer<T>>;
//# sourceMappingURL=ValidatedLlmInvoker.d.ts.map