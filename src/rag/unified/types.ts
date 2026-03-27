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

import type { RetrievalStrategy, RetrievedChunk } from '../../query-router/types.js';

// ============================================================================
// RETRIEVAL PLAN
// ============================================================================

/**
 * Structured retrieval plan produced by the query classifier.
 *
 * Replaces the simple `'none'|'simple'|'moderate'|'complex'` strategy string
 * with a granular specification of what retrieval sources to use, how to
 * combine them, and what memory types to consult.
 *
 * The plan is data — it describes WHAT to do, not HOW. The
 * {@link UnifiedRetriever} interprets the plan and executes it.
 *
 * @example
 * ```typescript
 * const plan: RetrievalPlan = {
 *   strategy: 'moderate',
 *   sources: { vector: true, bm25: true, graph: true, raptor: true, memory: true, multimodal: false },
 *   hyde: { enabled: true, hypothesisCount: 1 },
 *   memoryTypes: ['episodic', 'semantic'],
 *   modalities: ['text'],
 *   temporal: { preferRecent: false, recencyBoost: 1.0, maxAgeMs: null },
 *   graphConfig: { maxDepth: 2, minEdgeWeight: 0.3 },
 *   raptorLayers: [0, 1],
 *   deepResearch: false,
 *   confidence: 0.85,
 *   reasoning: 'Moderate complexity question about auth architecture.',
 * };
 * ```
 *
 * @see buildDefaultPlan for creating sensible defaults per strategy level
 */
export interface RetrievalPlan {
  /**
   * Base retrieval strategy (determines overall pipeline depth).
   *
   * Maps to the existing strategy tier system but carries richer config.
   * - `'none'`: Skip retrieval entirely.
   * - `'simple'`: Vector + BM25 only. Fast path.
   * - `'moderate'`: All sources, HyDE enabled, single pass.
   * - `'complex'`: All sources, HyDE with multi-hypothesis, deep research, decomposition.
   */
  strategy: RetrievalStrategy;

  /**
   * Which retrieval sources to query.
   *
   * Each flag independently enables or disables a retrieval source.
   * The UnifiedRetriever skips sources whose dependencies are not
   * available at runtime regardless of these flags.
   */
  sources: RetrievalPlanSources;

  /**
   * HyDE (Hypothetical Document Embedding) configuration.
   *
   * When enabled, a hypothetical answer is generated via LLM before
   * embedding, bridging vocabulary gaps between questions and documents.
   *
   * @see HydeRetriever
   */
  hyde: {
    /** Whether to use HyDE for this retrieval. */
    enabled: boolean;
    /**
     * Number of diverse hypotheses to generate.
     * More hypotheses improve recall at the cost of additional LLM calls.
     * @default 1 for moderate, 3 for complex
     */
    hypothesisCount: number;
  };

  /**
   * Which cognitive memory types to consult.
   *
   * - `'episodic'`: Past interactions, events, conversations.
   * - `'semantic'`: Facts, knowledge, learned concepts.
   * - `'procedural'`: Workflows, how-to knowledge, skills.
   * - `'prospective'`: Upcoming intentions, reminders, planned actions.
   */
  memoryTypes: MemoryTypeFilter[];

  /**
   * Which content modalities to search in multimodal index.
   *
   * Text search is always performed via vector/BM25 sources;
   * non-text modalities are handled by the multimodal indexer.
   */
  modalities: ModalityFilter[];

  /**
   * Temporal preferences for result ordering and filtering.
   *
   * Controls whether recent results are boosted and how aggressively
   * older content is penalized.
   */
  temporal: TemporalConfig;

  /**
   * Graph traversal configuration for GraphRAG source.
   *
   * Controls the depth and selectivity of entity relationship traversal
   * starting from seed chunks discovered by vector/BM25 search.
   */
  graphConfig: GraphTraversalConfig;

  /**
   * Which RAPTOR tree layers to search.
   *
   * - `0`: Leaf chunks (original documents) — detail queries.
   * - `1`: First-level cluster summaries — theme queries.
   * - `2+`: Higher-level summaries — "big picture" queries.
   *
   * An empty array searches all layers (default RAPTOR behaviour).
   */
  raptorLayers: number[];

  /**
   * Whether deep research mode is enabled.
   *
   * Deep research decomposes the query into sub-queries and recurses
   * with moderate-level plans per sub-query. Only used with `complex`
   * strategy.
   */
  deepResearch: boolean;

  /**
   * Confidence score from the classifier (0 to 1).
   *
   * Indicates how certain the classifier is about this plan.
   * Low confidence may trigger plan escalation in the router.
   */
  confidence: number;

  /**
   * Human-readable reasoning from the classifier explaining why
   * this plan was selected.
   */
  reasoning: string;
}

// ── Sub-types ─────────────────────────────────────────────────────────────

/**
 * Flags controlling which retrieval sources are queried.
 *
 * @see RetrievalPlan.sources
 */
export interface RetrievalPlanSources {
  /** Dense vector similarity search. Default: true for all strategies except 'none'. */
  vector: boolean;
  /** BM25 sparse keyword search. Default: true — catches exact term matches. */
  bm25: boolean;
  /** GraphRAG entity/relationship traversal. Default: true for moderate+. */
  graph: boolean;
  /** RAPTOR hierarchical summary tree. Default: true for moderate+. */
  raptor: boolean;
  /** Cognitive memory (episodic/semantic/procedural). Default: true for simple+. */
  memory: boolean;
  /** Multimodal content (images/audio/video). Default: false unless modalities include non-text. */
  multimodal: boolean;
}

/**
 * Cognitive memory type filter.
 *
 * @see RetrievalPlan.memoryTypes
 */
export type MemoryTypeFilter = 'episodic' | 'semantic' | 'procedural' | 'prospective';

/**
 * Content modality filter for multimodal search.
 *
 * @see RetrievalPlan.modalities
 */
export type ModalityFilter = 'text' | 'image' | 'audio' | 'video';

/**
 * Temporal preferences for result ordering.
 *
 * @see RetrievalPlan.temporal
 */
export interface TemporalConfig {
  /** Whether to boost recent results in scoring. Default: false. */
  preferRecent: boolean;
  /**
   * Multiplicative boost factor for recent results.
   * 1.0 means no boost. 2.0 means recent results can score up to 2x higher.
   * @default 1.0
   */
  recencyBoost: number;
  /**
   * Maximum age in milliseconds. Results older than this are excluded.
   * `null` means no age limit.
   * @default null
   */
  maxAgeMs: number | null;
}

/**
 * Graph traversal configuration for GraphRAG.
 *
 * @see RetrievalPlan.graphConfig
 */
export interface GraphTraversalConfig {
  /**
   * Maximum depth to traverse from seed entities.
   * @default 2
   */
  maxDepth: number;
  /**
   * Minimum edge weight to follow during traversal.
   * Edges below this weight are pruned.
   * @default 0.3
   */
  minEdgeWeight: number;
}

// ============================================================================
// UNIFIED RETRIEVAL RESULT
// ============================================================================

/**
 * Result returned by the UnifiedRetriever after executing a RetrievalPlan.
 *
 * Contains the merged, reranked chunks from all queried sources along with
 * diagnostics about which sources contributed and how long each took.
 *
 * @see UnifiedRetriever.retrieve
 */
export interface UnifiedRetrievalResult {
  /** Merged and reranked content chunks, sorted by relevance (highest first). */
  chunks: RetrievedChunk[];

  /**
   * Research synthesis narrative when deep research was performed.
   * Present only when the plan's `deepResearch` flag was true and
   * a deep research callback was available.
   */
  researchSynthesis?: string;

  /** The plan that was executed to produce this result. */
  plan: RetrievalPlan;

  /** Per-source diagnostics showing contributions and timing. */
  sourceDiagnostics: SourceDiagnostics;

  /** Total wall-clock duration of the retrieval in milliseconds. */
  durationMs: number;

  /** Whether a memory cache hit was used (episodic memory shortcut). */
  memoryCacheHit: boolean;
}

/**
 * Per-source diagnostics for a unified retrieval operation.
 *
 * Reports how many chunks each source contributed and how long
 * each source query took. Sources that were not queried or failed
 * will have `chunkCount: 0`.
 *
 * @see UnifiedRetrievalResult.sourceDiagnostics
 */
export interface SourceDiagnostics {
  /** Vector + BM25 hybrid search diagnostics. */
  hybrid: { chunkCount: number; durationMs: number };
  /** RAPTOR tree search diagnostics. */
  raptor: { chunkCount: number; durationMs: number };
  /** GraphRAG search diagnostics. */
  graph: { chunkCount: number; durationMs: number };
  /** Cognitive memory search diagnostics. */
  memory: { chunkCount: number; durationMs: number };
  /** Multimodal search diagnostics. */
  multimodal: { chunkCount: number; durationMs: number };
  /** HyDE hypothesis search diagnostics. */
  hyde: { chunkCount: number; durationMs: number; hypothesisCount: number };
  /** Reranking diagnostics. */
  rerank: { inputCount: number; outputCount: number; durationMs: number };
  /** Deep research diagnostics. */
  research: { chunkCount: number; durationMs: number };
}

// ============================================================================
// UNIFIED RETRIEVER EVENT
// ============================================================================

/**
 * Events emitted by the UnifiedRetriever during retrieval.
 *
 * Follows the same discriminated-union pattern as QueryRouterEventUnion.
 *
 * @see UnifiedRetriever
 */
export type UnifiedRetrieverEvent =
  | { type: 'unified:plan-start'; plan: RetrievalPlan; timestamp: number }
  | { type: 'unified:memory-cache-hit'; query: string; cacheAge: number; timestamp: number }
  | { type: 'unified:source-complete'; source: string; chunkCount: number; durationMs: number; timestamp: number }
  | { type: 'unified:source-error'; source: string; error: string; timestamp: number }
  | { type: 'unified:merge-complete'; totalChunks: number; timestamp: number }
  | { type: 'unified:rerank-complete'; inputCount: number; outputCount: number; durationMs: number; timestamp: number }
  | { type: 'unified:decompose'; subQueries: string[]; timestamp: number }
  | { type: 'unified:memory-feedback'; tracesStored: number; timestamp: number }
  | { type: 'unified:complete'; result: UnifiedRetrievalResult; timestamp: number };

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
export function buildDefaultPlan(
  strategy: RetrievalStrategy,
  overrides?: Partial<RetrievalPlan>,
): RetrievalPlan {
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
const DEFAULT_PLANS: Record<RetrievalStrategy, RetrievalPlan> = {
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
    memoryTypes: ['episodic', 'semantic', 'procedural', 'prospective'],
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
// EXECUTION PLAN (extends RetrievalPlan with capability recommendations)
// ============================================================================

/**
 * A recommended skill to activate for the current query.
 *
 * Skills are higher-level capabilities (e.g., "web-search", "coding-agent")
 * that encapsulate multi-step workflows. The classifier recommends skills
 * based on Tier 0 category summaries from the discovery engine.
 *
 * @see ExecutionPlan.skills
 */
export interface SkillRecommendation {
  /** Skill ID from the registry (e.g., "web-search", "deep-research"). */
  skillId: string;

  /** Human-readable reasoning for why this skill was recommended. */
  reasoning: string;

  /**
   * Confidence that this skill is needed for the query (0 to 1).
   * Higher values indicate stronger relevance signals.
   */
  confidence: number;

  /**
   * Priority order for activation (lower = higher priority).
   * Used when the runtime must limit concurrent skill activations.
   */
  priority: number;
}

/**
 * A recommended tool to make available for the current query.
 *
 * Tools are atomic operations (e.g., "generateImage", "webSearch") that the
 * agent can invoke. The classifier recommends tools when the query implies
 * a specific action rather than just retrieval.
 *
 * @see ExecutionPlan.tools
 */
export interface ToolRecommendation {
  /** Tool ID from the registry (e.g., "generateImage", "webSearch"). */
  toolId: string;

  /** Human-readable reasoning for why this tool was recommended. */
  reasoning: string;

  /**
   * Confidence that this tool is needed for the query (0 to 1).
   * Higher values indicate stronger relevance signals.
   */
  confidence: number;

  /**
   * Priority order for activation (lower = higher priority).
   * Used when the runtime must limit concurrent tool activations.
   */
  priority: number;
}

/**
 * A recommended extension to load for the current query.
 *
 * Extensions are richer capability bundles (e.g., "browser-automation",
 * "voice-synthesis") that may include multiple tools, configuration,
 * and lifecycle hooks. Loading an extension is heavier than a single tool.
 *
 * @see ExecutionPlan.extensions
 */
export interface ExtensionRecommendation {
  /** Extension ID from the registry (e.g., "browser-automation", "pii-redaction"). */
  extensionId: string;

  /** Human-readable reasoning for why this extension was recommended. */
  reasoning: string;

  /**
   * Confidence that this extension is needed for the query (0 to 1).
   * Higher values indicate stronger relevance signals.
   */
  confidence: number;

  /**
   * Priority order for loading (lower = higher priority).
   * Used when the runtime must limit concurrent extension loads.
   */
  priority: number;
}

/**
 * Extension of {@link RetrievalPlan} that also recommends skills, tools,
 * and extensions to activate for this query.
 *
 * The classifier uses the {@link CapabilityDiscoveryEngine}'s Tier 0 summaries
 * (category-level overview of all available capabilities) to decide
 * what's relevant. This avoids loading full tool schemas until needed,
 * keeping the classification prompt token-efficient (~150 extra tokens
 * for the full capability overview).
 *
 * The ExecutionPlan is a superset of RetrievalPlan — it carries all the
 * retrieval configuration (sources, HyDE, memory, etc.) plus capability
 * activation recommendations. The QueryRouter produces an ExecutionPlan,
 * then the agent runtime decides which recommendations to honor.
 *
 * @example
 * ```typescript
 * const plan: ExecutionPlan = {
 *   ...buildDefaultPlan('moderate'),
 *   skills: [{ skillId: 'web-search', reasoning: 'User asked to find info online', confidence: 0.9, priority: 0 }],
 *   tools: [],
 *   extensions: [],
 *   requiresExternalCalls: true,
 *   internalKnowledgeSufficient: false,
 * };
 * ```
 *
 * @see RetrievalPlan for the base retrieval configuration
 * @see SkillRecommendation for skill recommendation details
 * @see ToolRecommendation for tool recommendation details
 * @see ExtensionRecommendation for extension recommendation details
 */
export interface ExecutionPlan extends RetrievalPlan {
  /**
   * Skills to activate for this query.
   *
   * Sorted by priority (ascending — lower priority number = higher importance).
   * Empty array when no skills are recommended.
   */
  skills: SkillRecommendation[];

  /**
   * Tools to make available for this query.
   *
   * Sorted by priority (ascending — lower priority number = higher importance).
   * Empty array when no specific tools are recommended beyond defaults.
   */
  tools: ToolRecommendation[];

  /**
   * Extensions to load for this query.
   *
   * Sorted by priority (ascending — lower priority number = higher importance).
   * Empty array when no extensions are recommended.
   */
  extensions: ExtensionRecommendation[];

  /**
   * Whether the query requires any external API calls (web search, tool
   * invocations, etc.) beyond internal knowledge retrieval.
   *
   * When `false`, the agent can answer from the corpus and memory alone.
   */
  requiresExternalCalls: boolean;

  /**
   * Whether the query can be answered from internal knowledge only
   * (corpus + memory) without any skill/tool activation.
   *
   * This is the inverse signal to {@link requiresExternalCalls} but
   * both are kept explicit for clarity — a query may require external
   * calls for enrichment even when internal knowledge is technically
   * sufficient for a basic answer.
   */
  internalKnowledgeSufficient: boolean;
}

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
export function buildDefaultExecutionPlan(
  strategy: RetrievalStrategy,
  overrides?: Partial<ExecutionPlan>,
): ExecutionPlan {
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
