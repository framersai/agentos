/**
 * @fileoverview Capability Context Assembler — tiered, token-budgeted context builder.
 * @module @framers/agentos/discovery/CapabilityContextAssembler
 *
 * Assembles the capability discovery context for injection into agent prompts.
 * Enforces hard token budgets per tier to prevent context rot.
 *
 * Three tiers (inspired by Anthropic's defer_loading + Redis Tool RAG):
 *
 * Tier 0 (~150 tokens): Category summaries — always in context
 *   "Available categories: Information (4), Developer (3), Communication (8)..."
 *
 * Tier 1 (~200 tokens): Retrieved summaries — per-turn semantic retrieval
 *   "1. web-search (tool, 0.87): Search web. Params: query, max_results"
 *
 * Tier 2 (~1500 tokens): Full details — top-2 most relevant capabilities
 *   Full JSON schema or SKILL.md content
 *
 * Token budgets are hard-enforced by the assembler, NOT the LLM.
 * This is critical for preventing context rot (Chroma 2025).
 */
import type { CapabilityDescriptor, CapabilityDiscoveryConfig, CapabilityDiscoveryResult, CapabilitySearchResult } from './types.js';
import { CapabilityEmbeddingStrategy } from './CapabilityEmbeddingStrategy.js';
export declare class CapabilityContextAssembler {
    private readonly strategy;
    private cachedTier0;
    private cachedTier0Version;
    constructor(strategy?: CapabilityEmbeddingStrategy);
    /**
     * Build Tier 0 category summary text.
     * Regenerated only when capabilities change (tracked by version).
     */
    buildTier0(capabilities: CapabilityDescriptor[], version: number): string;
    /**
     * Assemble discovery context from search results.
     *
     * Takes raw search results (already filtered and graph-reranked),
     * applies token budgets, and produces the final tiered result.
     */
    assemble(tier0Text: string, searchResults: CapabilitySearchResult[], config?: CapabilityDiscoveryConfig, timings?: {
        embeddingTimeMs: number;
        graphTraversalTimeMs: number;
    }): CapabilityDiscoveryResult;
    /**
     * Render a CapabilityDiscoveryResult into a single string
     * suitable for injection into PromptBuilder.
     */
    renderForPrompt(result: CapabilityDiscoveryResult): string;
    /**
     * Invalidate the Tier 0 cache (e.g., after capabilities change).
     */
    invalidateCache(): void;
}
//# sourceMappingURL=CapabilityContextAssembler.d.ts.map