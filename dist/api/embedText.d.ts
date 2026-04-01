import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for an {@link embedText} call.
 *
 * At minimum, `input` must be provided. Provider/model resolution follows
 * the same rules as {@link generateText}: supply `provider`, `model`
 * (optionally in `provider:model` format), or rely on env-var auto-detection.
 *
 * @example
 * ```ts
 * const opts: EmbedTextOptions = {
 *   model: 'openai:text-embedding-3-small',
 *   input: ['Hello world', 'Goodbye world'],
 *   dimensions: 256,
 * };
 * ```
 */
export interface EmbedTextOptions {
    /**
     * Provider name. When supplied without `model`, the default embedding model
     * for the provider is resolved automatically from the built-in defaults.
     *
     * @example `"openai"`, `"ollama"`, `"openrouter"`
     */
    provider?: string;
    /**
     * Model identifier. Accepts `"provider:model"` or plain model name with `provider`.
     *
     * @example `"openai:text-embedding-3-small"`, `"nomic-embed-text"`
     */
    model?: string;
    /**
     * Text(s) to embed. Pass a single string for one embedding or an array
     * for batch processing.
     *
     * @example
     * ```ts
     * // Single input
     * input: 'Hello world'
     * // Batch input
     * input: ['Hello world', 'Goodbye world']
     * ```
     */
    input: string | string[];
    /**
     * Desired output dimensionality. Only honoured by models that support
     * dimension reduction (e.g. OpenAI `text-embedding-3-*` with `dimensions`).
     * Ignored when the model has a fixed output size.
     */
    dimensions?: number;
    /** Override the API key instead of reading from environment variables. */
    apiKey?: string;
    /** Override the provider base URL (useful for local proxies or Ollama). */
    baseUrl?: string;
    /** Optional durable usage ledger configuration for helper-level accounting. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * The result returned by {@link embedText}.
 *
 * @example
 * ```ts
 * const { embeddings, usage } = await embedText({
 *   model: 'openai:text-embedding-3-small',
 *   input: ['Hello', 'World'],
 * });
 * console.log(embeddings.length); // 2
 * console.log(embeddings[0].length); // e.g. 1536
 * ```
 */
export interface EmbedTextResult {
    /**
     * One embedding vector per input string. Each vector is a plain `number[]`
     * of floats whose dimensionality depends on the model (and the optional
     * `dimensions` parameter).
     */
    embeddings: number[][];
    /** Model identifier reported by the provider (may differ from the requested model). */
    model: string;
    /** Provider identifier used for the run. */
    provider: string;
    /**
     * Token usage for the embedding request.
     * Most embedding APIs only report prompt tokens (the input); completion
     * tokens are typically zero.
     */
    usage: {
        /** Number of tokens consumed by the input text(s). */
        promptTokens: number;
        /** Sum of prompt and any other tokens (usually equal to `promptTokens`). */
        totalTokens: number;
    };
}
/**
 * Generates embedding vectors for one or more text inputs using a
 * provider-agnostic `provider:model` string.
 *
 * Resolves credentials via the standard AgentOS provider pipeline, then
 * dispatches to the appropriate embedding endpoint (OpenAI, Ollama, or
 * OpenRouter). Returns raw float arrays suitable for vector similarity
 * search, clustering, or any downstream ML pipeline.
 *
 * @param opts - Embedding options including model, input text(s), and
 *   optional provider/key overrides.
 * @returns A promise resolving to the embedding vectors, provider metadata,
 *   and token usage.
 *
 * @throws {Error} When provider resolution fails (missing API key, unknown
 *   provider, etc.).
 * @throws {Error} When the embedding API returns a non-2xx status.
 *
 * @example
 * ```ts
 * import { embedText } from '@framers/agentos';
 *
 * // Single input
 * const { embeddings } = await embedText({
 *   model: 'openai:text-embedding-3-small',
 *   input: 'Hello world',
 * });
 * console.log(embeddings[0].length); // 1536
 *
 * // Batch with reduced dimensions
 * const batch = await embedText({
 *   model: 'openai:text-embedding-3-small',
 *   input: ['Hello', 'World'],
 *   dimensions: 256,
 * });
 * console.log(batch.embeddings.length); // 2
 * console.log(batch.embeddings[0].length); // 256
 * ```
 *
 * @see {@link generateText} for text generation.
 * @see {@link resolveModelOption} for provider auto-detection behaviour.
 */
export declare function embedText(opts: EmbedTextOptions): Promise<EmbedTextResult>;
//# sourceMappingURL=embedText.d.ts.map