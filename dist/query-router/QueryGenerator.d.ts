/**
 * @fileoverview QueryGenerator — tier-appropriate prompt construction and LLM
 * answer generation for the QueryRouter pipeline.
 *
 * The generator is the final stage of the routing pipeline: it takes the
 * classified {@link QueryTier}, a set of {@link RetrievedChunk}s from the
 * retrieval phase, and an optional research synthesis narrative, then builds
 * a tier-specific system prompt and invokes the LLM via {@link generateText}.
 *
 * **Tier-specific behaviour:**
 *
 * | Tier | Model   | Context | Temperature | Max Tokens | Instruction                                        |
 * |------|---------|---------|-------------|------------|----------------------------------------------------|
 * | T0   | standard| none    | 0.7         | 512        | (base prompt only)                                 |
 * | T1   | standard| chunks  | 0.3         | 512        | "Answer based on the documentation context provided."|
 * | T2   | deep    | chunks  | 0.3         | 1024       | "cross-reference" sources                          |
 * | T3   | deep    | chunks + research | 0.3 | 1024   | "Synthesize information from both internal documentation and external research." |
 *
 * **Context injection:**
 * Each chunk is formatted as `## heading (sourcePath)\ncontent` and appended
 * until the estimated token budget (`maxContextTokens`) is exhausted. Token
 * estimation uses the common heuristic of `Math.ceil(text.length / 4)`.
 *
 * @module @framers/agentos/query-router/QueryGenerator
 */
import type { QueryTier, RetrievedChunk } from './types.js';
/**
 * Configuration for the {@link QueryGenerator}.
 */
export interface QueryGeneratorConfig {
    /**
     * Model identifier for T0 and T1 queries (standard complexity).
     * @example 'openai:gpt-4.1-mini'
     */
    model: string;
    /**
     * Model identifier for T2 and T3 queries (deep reasoning).
     * @example 'openai:gpt-4.1'
     */
    modelDeep: string;
    /**
     * LLM provider name (e.g. 'openai', 'anthropic').
     */
    provider: string;
    /**
     * Optional API key override. When omitted, the provider resolves
     * credentials from environment variables.
     */
    apiKey?: string;
    /**
     * Optional base URL override for local proxies or alternative endpoints.
     */
    baseUrl?: string;
    /**
     * Maximum number of estimated tokens to allocate for documentation
     * context in the system prompt. Chunks are added in order until
     * this budget is exhausted.
     * @default 4000
     */
    maxContextTokens?: number;
}
/**
 * Structured result returned by {@link QueryGenerator.generate}.
 */
export interface GenerateResult {
    /** The generated answer text. */
    answer: string;
    /** The model identifier that was actually used for generation. */
    model: string;
    /** Token usage figures reported by the provider. */
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
/**
 * Builds tier-appropriate prompts and generates LLM answers.
 *
 * The generator selects a model (standard vs. deep) based on the query tier,
 * constructs a system prompt with optional documentation context and research
 * synthesis, then delegates to {@link generateText} for the actual LLM call.
 *
 * @example
 * ```typescript
 * const gen = new QueryGenerator({
 *   model: 'openai:gpt-4.1-mini',
 *   modelDeep: 'openai:gpt-4.1',
 *   provider: 'openai',
 * });
 *
 * const result = await gen.generate('How does auth work?', 1, chunks);
 * console.log(result.answer);
 * ```
 */
export declare class QueryGenerator {
    /** Resolved configuration with defaults applied. */
    private readonly config;
    /**
     * Create a new QueryGenerator instance.
     *
     * @param config - Generator configuration specifying models, provider,
     *                 and optional credential overrides.
     */
    constructor(config: QueryGeneratorConfig);
    /**
     * Generate an answer for the given query at the specified complexity tier.
     *
     * @param query - The user's original question.
     * @param tier - The classified complexity tier (0–3).
     * @param chunks - Retrieved documentation chunks, sorted by relevance.
     * @param researchSynthesis - Optional research narrative (T3 only).
     * @returns A promise resolving to the generated answer, model used, and token usage.
     */
    generate(query: string, tier: QueryTier, chunks: RetrievedChunk[], researchSynthesis?: string): Promise<GenerateResult>;
    /**
     * Select the appropriate model based on query tier.
     * T0–T1 use the standard model; T2–T3 use the deep model.
     *
     * @param tier - The classified query tier.
     * @returns The model identifier string.
     */
    private selectModel;
    /**
     * Select the sampling temperature for the given tier.
     * T0 uses a higher temperature (0.7) for more creative general answers;
     * all other tiers use 0.3 for focused, grounded responses.
     *
     * @param tier - The classified query tier.
     * @returns The temperature value.
     */
    private selectTemperature;
    /**
     * Select the maximum output tokens for the given tier.
     * T0–T1 cap at 512 tokens; T2–T3 allow 1024 for more detailed answers.
     *
     * @param tier - The classified query tier.
     * @returns The maxTokens value.
     */
    private selectMaxTokens;
    /**
     * Build the full system prompt by composing the base prompt with optional
     * tier-specific context blocks and instructions.
     *
     * @param tier - The classified query tier.
     * @param chunks - Retrieved documentation chunks.
     * @param researchSynthesis - Optional research narrative for T3.
     * @returns The assembled system prompt string.
     */
    private buildSystemPrompt;
    /**
     * Format retrieved chunks into a documentation context block, respecting
     * the configured token budget.
     *
     * Each chunk is formatted as:
     * ```
     * ## heading (sourcePath)
     * content
     * ```
     *
     * Chunks are added in the order provided (typically by relevance) until the
     * estimated token count would exceed `maxContextTokens`.
     *
     * @param chunks - The retrieved chunks to format.
     * @returns The formatted context string, or an empty string if no chunks fit.
     */
    private formatChunksAsContext;
    /**
     * Return the tier-specific instruction appended to the system prompt.
     *
     * @param tier - The classified query tier.
     * @returns The instruction string, or `undefined` for T0 (no extra instruction).
     */
    private getTierInstruction;
    /**
     * Estimate the token count for a string using the common heuristic of
     * approximately 4 characters per token.
     *
     * @param text - The text to estimate.
     * @returns Estimated token count (ceiling).
     */
    private estimateTokens;
}
//# sourceMappingURL=QueryGenerator.d.ts.map