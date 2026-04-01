/**
 * @fileoverview Core types for the Capability Discovery Engine.
 * @module @framers/agentos/discovery/types
 *
 * Provides unified type definitions for normalizing tools, skills, extensions,
 * and channels into a searchable, tiered capability discovery system.
 *
 * Key concepts:
 * - CapabilityDescriptor: Unified shape for any capability in the system
 * - Three-tier context budgeting: Always → Retrieved summaries → Full details
 * - ICapabilityGraph: Abstraction for relationship graphs (graphology now, Neo4j later)
 */
// ============================================================================
// TIER SYSTEM
// ============================================================================
/**
 * Tier classification for context budget management.
 *
 * Tier 0: Always in context (~150 tokens) — category summaries only
 * Tier 1: Retrieved on relevance (~200 tokens) — name + description + key params
 * Tier 2: Deep pull (~1500 tokens) — full schema + examples + relationship context
 */
export var CapabilityTier;
(function (CapabilityTier) {
    /** Always in context: category summaries */
    CapabilityTier[CapabilityTier["TIER_0_ALWAYS"] = 0] = "TIER_0_ALWAYS";
    /** Retrieved on relevance: name + description + key params */
    CapabilityTier[CapabilityTier["TIER_1_SUMMARY"] = 1] = "TIER_1_SUMMARY";
    /** Deep pull: full schema + examples + relationship context */
    CapabilityTier[CapabilityTier["TIER_2_FULL"] = 2] = "TIER_2_FULL";
})(CapabilityTier || (CapabilityTier = {}));
/**
 * Default configuration values.
 */
export const DEFAULT_DISCOVERY_CONFIG = {
    tier0TokenBudget: 200,
    tier1TokenBudget: 800,
    tier2TokenBudget: 2000,
    tier1TopK: 5,
    tier2TopK: 2,
    tier1MinRelevance: 0.3,
    useGraphReranking: true,
    collectionName: 'capability_index',
    graphBoostFactor: 0.15,
};
//# sourceMappingURL=types.js.map