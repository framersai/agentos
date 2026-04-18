/**
 * @fileoverview Memory-specific HyDE (Hypothetical Document Embedding) retriever.
 *
 * Improves memory recall for vague or abstract queries by generating a
 * hypothetical memory trace BEFORE embedding. The hypothesis is closer
 * in embedding space to actual stored traces than the raw query.
 *
 * Cognitive science grounding: this mirrors the "generation effect" —
 * generating information about a topic activates related neural pathways
 * more strongly than passive recognition. By generating what a memory
 * WOULD look like, we activate the right retrieval pathways.
 *
 * Effective for:
 * - Abstract queries ("that deployment discussion")
 * - Emotional recall ("when they were upset")
 * - Temporal queries ("something from last week")
 * - Vague references ("the thing about cats")
 *
 * Auto-attached by CognitiveMemoryManager when any LLM invoker is available.
 * Remains opt-in per query via `options.hyde: true` on `retrieve()`.
 *
 * @module agentos/memory/retrieval/hyde/MemoryHydeRetriever
 * @see {@link CognitiveMemoryManager.retrieve} — consumes the hypothesis
 */
/** LLM invoker function signature matching AgentOS observer/reflector convention. */
type LlmInvoker = (systemPrompt: string, userPrompt: string) => Promise<string>;
/**
 * Memory-specific HyDE retriever that generates hypothetical memory traces.
 *
 * Implements the same `generateHypothesis()` interface expected by
 * CognitiveMemoryManager so it can be assigned via `setHydeRetriever()`.
 *
 * Lightweight: uses `maxTokens: 150` with no chain-of-thought. Target
 * latency is under 500ms with a fast model.
 *
 * @example
 * ```ts
 * const retriever = new MemoryHydeRetriever(llmInvoker);
 * const result = await retriever.generateHypothesis('what does the user like?');
 * // result.hypothesis = "User mentioned they enjoy hiking and cooking..."
 * ```
 */
export declare class MemoryHydeRetriever {
    private readonly llmInvoker;
    /**
     * @param llmInvoker - Function that calls an LLM with (systemPrompt, userPrompt).
     *   Typically reused from the observer, reflector, or feature detection config.
     */
    constructor(llmInvoker: LlmInvoker);
    /**
     * Generate a hypothetical memory trace for a recall query.
     *
     * The generated hypothesis is used as the embedding input for vector
     * search, producing results that are more semantically aligned with
     * actual stored traces.
     *
     * Returns the same shape as `HydeRetriever.generateHypothesis()` so
     * CognitiveMemoryManager can use it interchangeably.
     *
     * @param query - The recall query (e.g., "what does the user do for work?")
     * @returns Object with `hypothesis` text and `latencyMs` timing
     */
    generateHypothesis(query: string): Promise<{
        hypothesis: string;
        latencyMs: number;
    }>;
}
export {};
//# sourceMappingURL=MemoryHydeRetriever.d.ts.map