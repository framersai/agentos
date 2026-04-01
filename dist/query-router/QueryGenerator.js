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
import { generateText } from '../api/generateText.js';
// ============================================================================
// Constants
// ============================================================================
/**
 * Base system prompt injected into every generation call regardless of tier.
 * Establishes the assistant's persona and ground rules.
 */
const BASE_SYSTEM_PROMPT = 'You are a knowledgeable AI assistant for an autonomous agent platform. ' +
    'Answer questions accurately and concisely. If you don\'t know something, ' +
    'say so \u2014 do not make things up.';
/** Default maximum context tokens when not specified in config. */
const DEFAULT_MAX_CONTEXT_TOKENS = 4000;
// ============================================================================
// QueryGenerator
// ============================================================================
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
export class QueryGenerator {
    /**
     * Create a new QueryGenerator instance.
     *
     * @param config - Generator configuration specifying models, provider,
     *                 and optional credential overrides.
     */
    constructor(config) {
        this.config = {
            model: config.model,
            modelDeep: config.modelDeep,
            provider: config.provider,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            maxContextTokens: config.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
        };
    }
    /**
     * Generate an answer for the given query at the specified complexity tier.
     *
     * @param query - The user's original question.
     * @param tier - The classified complexity tier (0–3).
     * @param chunks - Retrieved documentation chunks, sorted by relevance.
     * @param researchSynthesis - Optional research narrative (T3 only).
     * @returns A promise resolving to the generated answer, model used, and token usage.
     */
    async generate(query, tier, chunks, researchSynthesis) {
        const model = this.selectModel(tier);
        const temperature = this.selectTemperature(tier);
        const maxTokens = this.selectMaxTokens(tier);
        const systemPrompt = this.buildSystemPrompt(tier, chunks, researchSynthesis);
        const result = await generateText({
            model,
            provider: this.config.provider,
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
            system: systemPrompt,
            prompt: query,
            temperature,
            maxTokens,
        });
        return {
            answer: result.text,
            model,
            usage: {
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
            },
        };
    }
    // --------------------------------------------------------------------------
    // Private — Model / parameter selection
    // --------------------------------------------------------------------------
    /**
     * Select the appropriate model based on query tier.
     * T0–T1 use the standard model; T2–T3 use the deep model.
     *
     * @param tier - The classified query tier.
     * @returns The model identifier string.
     */
    selectModel(tier) {
        return tier >= 2 ? this.config.modelDeep : this.config.model;
    }
    /**
     * Select the sampling temperature for the given tier.
     * T0 uses a higher temperature (0.7) for more creative general answers;
     * all other tiers use 0.3 for focused, grounded responses.
     *
     * @param tier - The classified query tier.
     * @returns The temperature value.
     */
    selectTemperature(tier) {
        return tier === 0 ? 0.7 : 0.3;
    }
    /**
     * Select the maximum output tokens for the given tier.
     * T0–T1 cap at 512 tokens; T2–T3 allow 1024 for more detailed answers.
     *
     * @param tier - The classified query tier.
     * @returns The maxTokens value.
     */
    selectMaxTokens(tier) {
        return tier >= 2 ? 1024 : 512;
    }
    // --------------------------------------------------------------------------
    // Private — System prompt construction
    // --------------------------------------------------------------------------
    /**
     * Build the full system prompt by composing the base prompt with optional
     * tier-specific context blocks and instructions.
     *
     * @param tier - The classified query tier.
     * @param chunks - Retrieved documentation chunks.
     * @param researchSynthesis - Optional research narrative for T3.
     * @returns The assembled system prompt string.
     */
    buildSystemPrompt(tier, chunks, researchSynthesis) {
        const parts = [BASE_SYSTEM_PROMPT];
        // Inject documentation context for T1+
        if (tier >= 1 && chunks.length > 0) {
            const contextBlock = this.formatChunksAsContext(chunks);
            if (contextBlock) {
                parts.push(`\nDocumentation context:\n${contextBlock}`);
            }
        }
        // Inject research synthesis for T3
        if (tier === 3 && researchSynthesis) {
            parts.push(`\nExternal research findings:\n${researchSynthesis}`);
        }
        // Append tier-specific instruction
        const instruction = this.getTierInstruction(tier);
        if (instruction) {
            parts.push(`\n${instruction}`);
        }
        return parts.join('\n');
    }
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
    formatChunksAsContext(chunks) {
        const entries = [];
        let tokenCount = 0;
        for (const chunk of chunks) {
            const entry = `## ${chunk.heading} (${chunk.sourcePath})\n${chunk.content}`;
            const entryTokens = this.estimateTokens(entry);
            if (tokenCount + entryTokens > this.config.maxContextTokens) {
                break;
            }
            entries.push(entry);
            tokenCount += entryTokens;
        }
        return entries.join('\n\n');
    }
    /**
     * Return the tier-specific instruction appended to the system prompt.
     *
     * @param tier - The classified query tier.
     * @returns The instruction string, or `undefined` for T0 (no extra instruction).
     */
    getTierInstruction(tier) {
        switch (tier) {
            case 0:
                return undefined;
            case 1:
                return 'Answer based on the documentation context provided.';
            case 2:
                return 'Answer based on the documentation context provided. ' +
                    'Where possible, cross-reference multiple sources to provide a comprehensive answer.';
            case 3:
                return 'Synthesize information from both internal documentation and external research. ' +
                    'Where possible, cross-reference multiple sources to provide a comprehensive answer.';
            default:
                return undefined;
        }
    }
    /**
     * Estimate the token count for a string using the common heuristic of
     * approximately 4 characters per token.
     *
     * @param text - The text to estimate.
     * @returns Estimated token count (ceiling).
     */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
}
//# sourceMappingURL=QueryGenerator.js.map