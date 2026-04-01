/**
 * @file streamObject.ts
 * Streaming structured output extraction for the AgentOS high-level API.
 *
 * Wraps {@link streamText} with incremental JSON parsing so callers can
 * observe partial objects as the LLM produces tokens, then receive a final
 * Zod-validated result once the stream completes.
 *
 * @see {@link generateObject} for the non-streaming counterpart.
 * @see {@link streamText} for the underlying streaming text primitive.
 */
import type { ZodType } from 'zod';
import type { Message, TokenUsage } from './generateText.js';
/**
 * Recursively makes every property in `T` optional, including nested objects.
 * Used to type the partial objects yielded by `StreamObjectResult.partialObjectStream`
 * as the LLM incrementally builds the JSON response.
 *
 * @typeParam T - The source type to make deeply partial.
 */
export type DeepPartial<T> = T extends object ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : T;
/**
 * Options for a {@link streamObject} call.
 *
 * Shares the same shape as {@link GenerateObjectOptions} from {@link generateObject}.
 * At minimum, `schema` and either `prompt` or `messages` must be supplied.
 *
 * @typeParam T - The Zod schema type defining the expected output shape.
 *
 * @example
 * ```ts
 * const opts: StreamObjectOptions<typeof mySchema> = {
 *   schema: z.object({ name: z.string(), items: z.array(z.string()) }),
 *   prompt: 'List 3 fruits with a person name',
 * };
 * ```
 */
export interface StreamObjectOptions<T extends ZodType> {
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
     * Human-readable name for the schema, injected into the system prompt.
     *
     * @example `"ShoppingList"`
     */
    schemaName?: string;
    /**
     * Description of the schema, injected into the system prompt.
     *
     * @example `"A shopping list with a person's name and items."`
     */
    schemaDescription?: string;
    /** User prompt. */
    prompt?: string;
    /** System prompt. Schema instructions are appended automatically. */
    system?: string;
    /** Full conversation history. */
    messages?: Message[];
    /** Sampling temperature forwarded to the provider. */
    temperature?: number;
    /** Hard cap on output tokens. */
    maxTokens?: number;
    /**
     * Number of retries on validation failure.
     * Unlike {@link generateObject}, streaming retries are not currently supported
     * (the stream is consumed once). This field is accepted for API symmetry but
     * is unused; validation errors on the final object throw immediately.
     *
     * @default 0
     */
    maxRetries?: number;
    /** Override the API key. */
    apiKey?: string;
    /** Override the provider base URL. */
    baseUrl?: string;
}
/**
 * The result object returned immediately by {@link streamObject}.
 *
 * Consumers iterate `partialObjectStream` for incremental partial objects,
 * or `await` the promise properties for the final validated result.
 *
 * @typeParam T - The inferred type from the Zod schema.
 */
export interface StreamObjectResult<T> {
    /**
     * Async iterable yielding partial objects as the LLM builds the JSON
     * response token by token. Each yielded value has the same shape as `T`
     * but with all fields optional ({@link DeepPartial}).
     *
     * @example
     * ```ts
     * for await (const partial of result.partialObjectStream) {
     *   console.log('partial:', partial);
     * }
     * ```
     */
    partialObjectStream: AsyncIterable<DeepPartial<T>>;
    /**
     * Resolves to the final Zod-validated object when the stream completes.
     *
     * @throws {ObjectGenerationError} When the final JSON fails validation.
     */
    object: Promise<T>;
    /** Resolves to the raw text when the stream completes. */
    text: Promise<string>;
    /** Resolves to aggregated token usage when the stream completes. */
    usage: Promise<TokenUsage>;
}
/**
 * Streams a structured object by incrementally parsing JSON as the LLM
 * produces tokens, then validates the final result against a Zod schema.
 *
 * Returns immediately with a {@link StreamObjectResult} containing async
 * iterables and promises. The underlying LLM call begins lazily when a
 * consumer starts iterating `partialObjectStream` or awaits a promise.
 *
 * @typeParam T - The Zod schema type. Partial objects are typed as
 *   `DeepPartial<z.infer<T>>`, and the final `object` promise resolves
 *   to `z.infer<T>`.
 *
 * @param opts - Streaming generation options including the Zod schema,
 *   prompt/messages, and optional provider/model overrides.
 * @returns A {@link StreamObjectResult} with `partialObjectStream`, `object`,
 *   `text`, and `usage` properties.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { streamObject } from '@framers/agentos';
 *
 * const result = streamObject({
 *   model: 'openai:gpt-4o',
 *   schema: z.object({ name: z.string(), hobbies: z.array(z.string()) }),
 *   prompt: 'Create a profile for a fictional character.',
 * });
 *
 * for await (const partial of result.partialObjectStream) {
 *   console.log('partial:', partial);
 * }
 *
 * const final = await result.object;
 * console.log('final:', final);
 * ```
 *
 * @see {@link generateObject} for non-streaming structured output.
 * @see {@link streamText} for plain text streaming.
 */
export declare function streamObject<T extends ZodType>(opts: StreamObjectOptions<T>): StreamObjectResult<z.infer<T>>;
import type { z } from 'zod';
//# sourceMappingURL=streamObject.d.ts.map