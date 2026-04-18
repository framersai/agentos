/**
 * @file generateObject.ts
 * Zod-validated structured output extraction for the AgentOS high-level API.
 *
 * Forces the LLM to produce JSON matching a caller-supplied Zod schema.  When
 * the provider supports native JSON mode (`response_format: { type: 'json_object' }`),
 * it is enabled automatically.  On parse or validation failure, the call is
 * retried with error feedback appended to the conversation so the model can
 * self-correct.
 *
 * @see {@link generateText} for the underlying text generation primitive.
 * @see {@link streamObject} for the streaming counterpart.
 */
import type { ZodType, ZodError } from 'zod';
import type { Message, SystemContentBlock, TokenUsage } from './generateText.js';
/**
 * Thrown when structured output generation fails after exhausting all retries.
 *
 * Captures both the raw LLM output and the Zod validation issues so callers
 * can inspect what went wrong and surface useful diagnostics.
 *
 * @example
 * ```ts
 * try {
 *   await generateObject({ schema: mySchema, prompt: '...' });
 * } catch (err) {
 *   if (err instanceof ObjectGenerationError) {
 *     console.error('Raw text:', err.rawText);
 *     console.error('Validation:', err.validationErrors);
 *   }
 * }
 * ```
 */
export declare class ObjectGenerationError extends Error {
    /** The raw text returned by the LLM on the final attempt. */
    readonly rawText: string;
    /** Zod validation error details from the last parse attempt, if available. */
    readonly validationErrors?: ZodError | undefined;
    /** The name of this error class, useful for `instanceof` checks across realms. */
    readonly name = "ObjectGenerationError";
    /**
     * @param message - Human-readable summary of the failure.
     * @param rawText - The last raw text the LLM produced before we gave up.
     * @param validationErrors - Zod validation issues from the final attempt.
     */
    constructor(message: string, 
    /** The raw text returned by the LLM on the final attempt. */
    rawText: string, 
    /** Zod validation error details from the last parse attempt, if available. */
    validationErrors?: ZodError | undefined);
}
/**
 * Options for a {@link generateObject} call.
 *
 * At minimum, `schema` and either `prompt` or `messages` must be supplied.
 * Provider/model resolution follows the same rules as {@link generateText}.
 *
 * @typeParam T - The Zod schema type that defines the expected output shape.
 *
 * @example
 * ```ts
 * const opts: GenerateObjectOptions<typeof mySchema> = {
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   prompt: 'Extract: "John is 30 years old"',
 * };
 * ```
 */
export interface GenerateObjectOptions<T extends ZodType> {
    /**
     * Provider name. When supplied without `model`, the default text model for
     * the provider is resolved automatically.
     *
     * @example `"openai"`, `"anthropic"`, `"ollama"`
     */
    provider?: string;
    /**
     * Model identifier. Accepts `"provider:model"` or plain model name with `provider`.
     *
     * @example `"openai:gpt-4o"`, `"gpt-4o-mini"`
     */
    model?: string;
    /** Zod schema defining the expected output shape. */
    schema: T;
    /**
     * Human-readable name for the schema, injected into the system prompt to
     * give the model context about what it is generating.
     *
     * @example `"PersonInfo"`
     */
    schemaName?: string;
    /**
     * Description of the schema, injected into the system prompt alongside
     * the JSON Schema definition.
     *
     * @example `"Information about a person extracted from unstructured text."`
     */
    schemaDescription?: string;
    /** User prompt. Convenience alternative to building a `messages` array. */
    prompt?: string;
    /**
     * System prompt. The schema extraction instructions are appended to this,
     * so any custom system context is preserved.
     *
     * Accepts a plain string (single system message) or an ordered array of
     * {@link SystemContentBlock} entries. When an array is supplied, caller
     * `cacheBreakpoint` flags are preserved on each block and a final
     * non-cached block is appended with the JSON schema + formatting rules.
     * This enables Anthropic prompt caching on the stable prefix while letting
     * the per-call schema vary freely.
     */
    system?: string | SystemContentBlock[];
    /** Full conversation history. */
    messages?: Message[];
    /** Sampling temperature forwarded to the provider (0-2 for most providers). */
    temperature?: number;
    /** Hard cap on output tokens. */
    maxTokens?: number;
    /**
     * Number of times to retry when JSON parsing or Zod validation fails.
     * Each retry appends the error details to the conversation so the model
     * can self-correct.
     *
     * @default 2
     */
    maxRetries?: number;
    /** Override the API key instead of reading from environment variables. */
    apiKey?: string;
    /** Override the provider base URL (useful for local proxies or Ollama). */
    baseUrl?: string;
    /**
     * Ordered fallback providers tried when the primary fails with a retryable
     * error. When undefined, auto-built from env keys. Pass `[]` to disable.
     * @see {@link import('./generateText.js').GenerateTextOptions.fallbackProviders}
     */
    fallbackProviders?: import('./generateText.js').FallbackProviderEntry[];
    /**
     * Called when a fallback provider is about to be tried.
     */
    onFallback?: (error: Error, fallbackProvider: string) => void;
}
/**
 * The completed result returned by {@link generateObject}.
 *
 * @typeParam T - The inferred type from the Zod schema, representing the validated object.
 */
export interface GenerateObjectResult<T> {
    /** The parsed, Zod-validated object matching the provided schema. */
    object: T;
    /** The raw LLM output text before parsing. */
    text: string;
    /** Aggregated token usage across all attempts (including retries). */
    usage: TokenUsage;
    /**
     * Reason the model stopped generating on the final successful attempt.
     * Mirrors the finish reasons from {@link generateText}.
     */
    finishReason: string;
    /** Provider identifier used for the run. */
    provider: string;
    /** Resolved model identifier used for the run. */
    model: string;
}
/**
 * Generates a structured object by forcing the LLM to produce JSON matching
 * a Zod schema.
 *
 * Combines schema-aware prompt engineering with optional provider-native JSON
 * mode and automatic retry-with-feedback to reliably extract typed data from
 * unstructured text.
 *
 * @typeParam T - The Zod schema type. The returned `object` field is inferred
 *   as `z.infer<T>`.
 *
 * @param opts - Generation options including the Zod schema, prompt/messages,
 *   and optional provider/model overrides.
 * @returns A promise resolving to the validated object, raw text, usage, and metadata.
 *
 * @throws {ObjectGenerationError} When all retries are exhausted without
 *   producing valid JSON that passes Zod validation.
 * @throws {Error} When provider resolution fails (missing API key, unknown provider, etc.).
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { generateObject } from '@framers/agentos';
 *
 * const { object } = await generateObject({
 *   model: 'openai:gpt-4o',
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   prompt: 'Extract: "John is 30 years old"',
 * });
 *
 * console.log(object.name); // "John"
 * console.log(object.age);  // 30
 * ```
 *
 * @see {@link streamObject} for streaming partial objects as they build up.
 * @see {@link generateText} for plain text generation without schema constraints.
 */
export declare function generateObject<T extends ZodType>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<z.infer<T>>>;
import type { z } from 'zod';
//# sourceMappingURL=generateObject.d.ts.map