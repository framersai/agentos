/**
 * @fileoverview Capability Embedding Strategy
 * @module @framers/agentos/discovery/CapabilityEmbeddingStrategy
 *
 * Constructs the embedding text for each capability descriptor.
 * The strategy captures WHEN a capability is useful (intent-oriented),
 * not just what it does (description-only).
 *
 * Design informed by:
 * - ToolLLM Neural API Retriever: embedding API docs (name, description, params)
 *   achieves NDCG@5 of 84.9 on 16K+ APIs
 * - MCP-RAG: decomposing tools into parameter-level embeddings improves matching
 * - Context Rot (Chroma 2025): keeping embedded text concise maximizes retrieval precision
 */
import type { CapabilityDescriptor } from './types.js';
/**
 * Builds optimized embedding text for capability descriptors.
 *
 * The embedding text is structured to maximize semantic match with user intents:
 * 1. Name/display name — captures exact-match queries
 * 2. Description — core semantic content
 * 3. Category + tags — captures categorical queries ("communication tool")
 * 4. Parameter names — captures action queries ("I need to search for X")
 * 5. Dependencies — captures composition queries ("tool that works with GitHub")
 */
export declare class CapabilityEmbeddingStrategy {
    /**
     * Build the text that will be embedded for a capability.
     * Designed to be concise (typically 100-300 tokens) while capturing
     * the key semantic signals for retrieval.
     */
    buildEmbeddingText(cap: CapabilityDescriptor): string;
    /**
     * Build a compact summary text for Tier 1 display.
     * This is shown to the LLM when a capability is retrieved as relevant.
     * Kept to ~30-50 tokens per capability.
     */
    buildCompactSummary(cap: CapabilityDescriptor): string;
    /**
     * Build the full detail text for Tier 2 injection.
     * Includes full schema and/or SKILL.md content.
     */
    buildFullDetailText(cap: CapabilityDescriptor): string;
}
//# sourceMappingURL=CapabilityEmbeddingStrategy.d.ts.map