/**
 * @fileoverview Types for the Unified Retrieval system.
 *
 * Defines the {@link RetrievalPlan} — a structured specification that replaces
 * the simple `'none'|'simple'|'moderate'|'complex'` strategy string with a
 * granular retrieval plan describing WHAT sources to query, HOW to combine
 * them, and WHAT memory types to consult.
 *
 * The plan is pure data — it describes intent, not execution. The
 * {@link UnifiedRetriever} interprets the plan and orchestrates the actual
 * retrieval across all enabled sources.
 *
 * @module agentos/rag/unified/types
 * @see UnifiedRetriever for the plan executor
 * @see QueryClassifier.classifyWithPlan for plan generation
 */
// ============================================================================
// DEFAULT PLAN BUILDER
// ============================================================================
/**
 * Creates a sensible default {@link RetrievalPlan} for a given strategy level.
 *
 * This is the canonical way to construct a plan when the classifier does not
 * produce a full plan (e.g., legacy tier-based classification, heuristic mode,
 * or fallback scenarios).
 *
 * Strategy defaults:
 * - **none**: All sources disabled, no HyDE, no memory, no research.
 * - **simple**: Vector + BM25 + memory (episodic, semantic). No HyDE.
 * - **moderate**: All sources enabled. HyDE with 1 hypothesis. Memory with
 *   episodic + semantic. RAPTOR layers 0-1. Graph depth 2.
 * - **complex**: All sources enabled. HyDE with 3 hypotheses. Full memory.
 *   Deep research. RAPTOR all layers. Graph depth 3.
 *
 * @param strategy - The base retrieval strategy.
 * @param overrides - Optional partial overrides to apply on top of defaults.
 * @returns A complete {@link RetrievalPlan}.
 *
 * @example
 * ```typescript
 * // Simple plan with defaults
 * const plan = buildDefaultPlan('moderate');
 *
 * // Complex plan with custom temporal preferences
 * const plan = buildDefaultPlan('complex', {
 *   temporal: { preferRecent: true, recencyBoost: 1.5, maxAgeMs: 86_400_000 },
 * });
 * ```
 */
export function buildDefaultPlan(strategy, overrides) {
    const base = DEFAULT_PLANS[strategy];
    if (!overrides) {
        return { ...base };
    }
    return {
        ...base,
        ...overrides,
        sources: { ...base.sources, ...overrides.sources },
        hyde: { ...base.hyde, ...overrides.hyde },
        temporal: { ...base.temporal, ...overrides.temporal },
        graphConfig: { ...base.graphConfig, ...overrides.graphConfig },
        memoryTypes: overrides.memoryTypes ?? base.memoryTypes,
        modalities: overrides.modalities ?? base.modalities,
        raptorLayers: overrides.raptorLayers ?? base.raptorLayers,
    };
}
// ── Default plan templates ────────────────────────────────────────────────
/**
 * Pre-built plan templates for each strategy level.
 *
 * These are the canonical defaults used by {@link buildDefaultPlan}.
 * They encode the recommended source selection, HyDE configuration,
 * and memory integration for each complexity tier.
 *
 * @internal
 */
const DEFAULT_PLANS = {
    none: {
        strategy: 'none',
        sources: { vector: false, bm25: false, graph: false, raptor: false, memory: false, multimodal: false },
        hyde: { enabled: false, hypothesisCount: 0 },
        memoryTypes: [],
        modalities: [],
        temporal: { preferRecent: false, recencyBoost: 1.0, maxAgeMs: null },
        graphConfig: { maxDepth: 0, minEdgeWeight: 0 },
        raptorLayers: [],
        deepResearch: false,
        confidence: 1.0,
        reasoning: 'No retrieval needed.',
    },
    simple: {
        strategy: 'simple',
        sources: { vector: true, bm25: true, graph: false, raptor: false, memory: true, multimodal: false },
        hyde: { enabled: false, hypothesisCount: 0 },
        memoryTypes: ['episodic', 'semantic'],
        modalities: ['text'],
        temporal: { preferRecent: false, recencyBoost: 1.0, maxAgeMs: null },
        graphConfig: { maxDepth: 0, minEdgeWeight: 0 },
        raptorLayers: [],
        deepResearch: false,
        confidence: 0.9,
        reasoning: 'Simple lookup — vector + BM25 + memory.',
    },
    moderate: {
        strategy: 'moderate',
        sources: { vector: true, bm25: true, graph: true, raptor: true, memory: true, multimodal: false },
        hyde: { enabled: true, hypothesisCount: 1 },
        memoryTypes: ['episodic', 'semantic'],
        modalities: ['text'],
        temporal: { preferRecent: false, recencyBoost: 1.0, maxAgeMs: null },
        graphConfig: { maxDepth: 2, minEdgeWeight: 0.3 },
        raptorLayers: [0, 1],
        deepResearch: false,
        confidence: 0.85,
        reasoning: 'Moderate complexity — all sources with HyDE.',
    },
    complex: {
        strategy: 'complex',
        sources: { vector: true, bm25: true, graph: true, raptor: true, memory: true, multimodal: false },
        hyde: { enabled: true, hypothesisCount: 3 },
        memoryTypes: ['episodic', 'semantic', 'procedural', 'prospective', 'relational'],
        modalities: ['text'],
        temporal: { preferRecent: false, recencyBoost: 1.0, maxAgeMs: null },
        graphConfig: { maxDepth: 3, minEdgeWeight: 0.2 },
        raptorLayers: [0, 1, 2],
        deepResearch: true,
        confidence: 0.8,
        reasoning: 'Complex research — all sources, multi-hypothesis HyDE, deep research.',
    },
};
// ============================================================================
// DEFAULT EXECUTION PLAN BUILDER
// ============================================================================
/**
 * Creates a sensible default {@link ExecutionPlan} for a given strategy level.
 *
 * Extends {@link buildDefaultPlan} with empty capability recommendation
 * arrays and sensible defaults for `requiresExternalCalls` and
 * `internalKnowledgeSufficient` based on the strategy.
 *
 * @param strategy - The base retrieval strategy.
 * @param overrides - Optional partial overrides to apply on top of defaults.
 * @returns A complete {@link ExecutionPlan}.
 *
 * @example
 * ```typescript
 * // Default execution plan with no capability recommendations
 * const plan = buildDefaultExecutionPlan('moderate');
 *
 * // Execution plan with pre-selected skills
 * const plan = buildDefaultExecutionPlan('complex', {
 *   skills: [{ skillId: 'web-search', reasoning: 'Query needs web data', confidence: 0.95, priority: 0 }],
 *   requiresExternalCalls: true,
 * });
 * ```
 */
export function buildDefaultExecutionPlan(strategy, overrides) {
    const base = buildDefaultPlan(strategy);
    return {
        ...base,
        skills: [],
        tools: [],
        extensions: [],
        requiresExternalCalls: strategy !== 'none',
        internalKnowledgeSufficient: strategy === 'none',
        ...overrides,
        // Ensure nested objects from base are correctly merged when overrides exist
        sources: { ...base.sources, ...overrides?.sources },
        hyde: { ...base.hyde, ...overrides?.hyde },
        temporal: { ...base.temporal, ...overrides?.temporal },
        graphConfig: { ...base.graphConfig, ...overrides?.graphConfig },
        memoryTypes: overrides?.memoryTypes ?? base.memoryTypes,
        modalities: overrides?.modalities ?? base.modalities,
        raptorLayers: overrides?.raptorLayers ?? base.raptorLayers,
    };
}
//# sourceMappingURL=types.js.map