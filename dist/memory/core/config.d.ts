/**
 * @fileoverview Configuration types for the Cognitive Memory System.
 * @module agentos/memory/config
 */
import type { IWorkingMemory } from '../../cognitive_substrate/memory/IWorkingMemory.js';
import type { IKnowledgeGraph } from '../retrieval/graph/knowledge/IKnowledgeGraph.js';
import type { IVectorStore } from '../../core/vector-store/IVectorStore.js';
import type { IEmbeddingManager } from '../../core/embeddings/IEmbeddingManager.js';
import type { MemoryBudgetAllocation } from './types.js';
import type { InfiniteContextConfig } from '../pipeline/context/types.js';
/** Pleasure-Arousal-Dominance emotional state. */
export interface PADState {
    valence: number;
    arousal: number;
    dominance: number;
}
export interface HexacoTraits {
    honesty?: number;
    emotionality?: number;
    extraversion?: number;
    agreeableness?: number;
    conscientiousness?: number;
    openness?: number;
}
export interface EncodingConfig {
    /** Base encoding strength before personality modulation. @default 0.5 */
    baseStrength: number;
    /** Emotional intensity threshold for flashbulb memory. @default 0.8 */
    flashbulbThreshold: number;
    /** Strength multiplier for flashbulb memories. @default 2.0 */
    flashbulbStrengthMultiplier: number;
    /** Stability multiplier for flashbulb memories. @default 5.0 */
    flashbulbStabilityMultiplier: number;
    /** Base stability in ms (how long before strength halves). @default 3_600_000 (1 hour) */
    baseStabilityMs: number;
}
export interface DecayConfig {
    /** Minimum strength before a trace is soft-deleted. @default 0.05 */
    pruningThreshold: number;
    /** Half-life for recency boost (ms). @default 86_400_000 (24 hours) */
    recencyHalfLifeMs: number;
    /** Cosine similarity threshold for interference detection. @default 0.7 */
    interferenceThreshold: number;
}
export interface ObserverConfig {
    /** Token threshold before observer activates. @default 30_000 */
    activationThresholdTokens: number;
    /** LLM model ID for observation extraction (per-persona). */
    modelId?: string;
    /** LLM invoker function. */
    llmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}
export interface ReflectorConfig {
    /** Token threshold for notes before reflection triggers. @default 40_000 */
    activationThresholdTokens: number;
    /** LLM model ID for reflection/consolidation (per-persona). */
    modelId?: string;
    /** LLM invoker function. */
    llmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}
/**
 * Configuration for the memory graph subsystem.
 *
 * The memory graph powers spreading activation (Collins & Quillian model),
 * Hebbian co-activation learning ("neurons that fire together wire together"),
 * conflict detection, clustering, and graph-boosted retrieval scoring.
 *
 * Enabled by default when CognitiveMemoryManager is initialized.
 * Set `disabled: true` to opt out entirely.
 */
export interface MemoryGraphConfig {
    /**
     * Set to true to disable the memory graph entirely.
     * When disabled, spreading activation, Hebbian co-activation,
     * and graph-based retrieval boosting are all skipped.
     * @default false
     */
    disabled?: boolean;
    /** Which graph backend to use. @default 'knowledge-graph' */
    backend?: 'graphology' | 'knowledge-graph';
    /** Max hops for spreading activation. @default 3 */
    maxDepth?: number;
    /** Activation decay per hop (0-1). @default 0.5 */
    decayPerHop?: number;
    /** Minimum activation to continue spreading (0-1). @default 0.1 */
    activationThreshold?: number;
    /** Hebbian learning rate for co-activation edge strengthening (0-1). @default 0.1 */
    hebbianLearningRate?: number;
}
/**
 * Default memory graph configuration.
 * Graph is enabled by default with the KnowledgeGraph backend,
 * providing spreading activation and Hebbian learning out of the box.
 */
export declare const DEFAULT_GRAPH_CONFIG: Required<Omit<MemoryGraphConfig, 'disabled'>> & {
    disabled: false;
};
export interface ConsolidationConfig {
    /**
     * Whether the periodic consolidation timer is active. Set to false
     * for short-lived contexts (benches, tests, one-shot scripts) where
     * a lingering `setInterval` would keep the Node event loop alive
     * past the meaningful work.
     *
     * When false, `CognitiveMemoryManager` still constructs the
     * pipeline so `runConsolidation()` works on-demand; only the
     * auto-started timer is suppressed.
     * @default true
     */
    enabled?: boolean;
    /** How often to run consolidation (ms). @default 3_600_000 (1 hour) */
    intervalMs: number;
    /** Max traces to process per cycle. @default 500 */
    maxTracesPerCycle: number;
    /** Similarity threshold for merging redundant traces. @default 0.92 */
    mergeSimilarityThreshold: number;
    /** Minimum cluster size for schema integration. @default 5 */
    minClusterSize: number;
    /**
     * What event or schedule triggers a consolidation run.
     * - `'turns'`    – fire after every N conversation turns (`every` = turn count).
     * - `'interval'` – fire on a wall-clock timer (`every` = milliseconds).
     * - `'manual'`   – only fire when explicitly requested.
     * @default 'interval'
     */
    trigger?: 'turns' | 'interval' | 'manual';
    /**
     * Numeric complement to `trigger`.
     * When `trigger='turns'` this is the turn count; when `trigger='interval'`
     * this is the millisecond period.
     * @default 3_600_000
     */
    every?: number;
    /**
     * Minimum Ebbinghaus strength below which a trace is pruned.
     * Must be between 0 and 1.
     * @default 0.05
     */
    pruneThreshold?: number;
    /**
     * Cosine similarity above which two traces are candidates for merging.
     * Must be between 0 and 1.
     * @default 0.92
     */
    mergeThreshold?: number;
    /**
     * Whether the consolidation engine should derive new insight traces from
     * clusters of related memories during each cycle.
     * @default true
     */
    deriveInsights?: boolean;
    /**
     * Maximum number of new insight traces the engine may derive per cycle.
     * Guards against unbounded graph growth.
     * @default 10
     */
    maxDerivedPerCycle?: number;
}
export interface CognitiveMemoryPersonaConfig {
    /** Feature detection strategy. @default 'keyword' */
    featureDetectionStrategy?: 'keyword' | 'llm' | 'hybrid';
    /** Working memory slot capacity override. */
    workingMemoryCapacity?: number;
    /** Token budget allocation percentages override. */
    tokenBudget?: Partial<MemoryBudgetAllocation>;
    /** Encoding config overrides. */
    encoding?: Partial<EncodingConfig>;
    /** Decay config overrides. */
    decay?: Partial<DecayConfig>;
    /** Observer config (Batch 2). */
    observer?: Partial<ObserverConfig>;
    /** Reflector config (Batch 2). */
    reflector?: Partial<ReflectorConfig>;
    /** Memory graph config (Batch 2). */
    graph?: Partial<MemoryGraphConfig>;
    /** Infinite context config (Batch 3). */
    infiniteContext?: Partial<InfiniteContextConfig>;
}
export interface CognitiveMemoryConfig {
    workingMemory: IWorkingMemory;
    knowledgeGraph: IKnowledgeGraph;
    vectorStore: IVectorStore;
    embeddingManager: IEmbeddingManager;
    agentId: string;
    traits: HexacoTraits;
    /** Callback to get current mood from MoodEngine or similar. */
    moodProvider: () => PADState;
    /** @default 'keyword' */
    featureDetectionStrategy: 'keyword' | 'llm' | 'hybrid';
    /** Required when strategy is 'llm' or 'hybrid'. */
    featureDetectionLlmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
    encoding?: Partial<EncodingConfig>;
    decay?: Partial<DecayConfig>;
    /** @default 7 (Miller's number) */
    workingMemoryCapacity?: number;
    tokenBudget?: Partial<MemoryBudgetAllocation>;
    observer?: Partial<ObserverConfig>;
    reflector?: Partial<ReflectorConfig>;
    graph?: Partial<MemoryGraphConfig>;
    consolidation?: Partial<ConsolidationConfig>;
    /** Optional per-mechanism cognitive science extensions (reconsolidation, RIF, FOK, etc.). */
    cognitiveMechanisms?: import('../mechanisms/types.js').CognitiveMechanismsConfig;
    /** Infinite context window config. Enables transparent compaction for forever conversations. */
    infiniteContext?: Partial<InfiniteContextConfig>;
    /** Max context window size in tokens (required for infinite context). */
    maxContextTokens?: number;
    /** @default 'cogmem' */
    collectionPrefix?: string;
    /**
     * Optional SqliteBrain instance for durable persistence.
     *
     * When provided, memory traces, knowledge graph nodes/edges,
     * prospective items, and observation pipeline state are persisted
     * to the brain's SQL tables via sql-storage-adapter. The in-memory
     * vector index remains the hot read path; SqliteBrain is the durable
     * backing store that survives process restarts.
     *
     * Falls back to in-memory-only storage when omitted.
     *
     * @default undefined (in-memory only)
     * @see {@link SqliteBrain} — the cross-platform persistence layer
     */
    brain?: import('../retrieval/store/SqliteBrain.js').SqliteBrain;
    /**
     * Optional reranker service for post-retrieval quality improvement.
     *
     * When provided, retrieved memory traces are reranked after the
     * cognitive scoring pipeline (vector similarity + strength + recency +
     * emotional congruence + graph activation + importance). The reranker
     * score is blended with the existing composite score at a 0.7/0.3
     * weighting to preserve cognitive signals while boosting semantically
     * relevant results.
     *
     * Recommended: Cohere rerank-v3.5 primary, LLM-Judge fallback.
     *
     * @default undefined (no reranking)
     */
    rerankerService?: import('../../rag/reranking/RerankerService.js').RerankerService;
    /**
     * Optional memory archive for write-ahead verbatim preservation.
     *
     * When provided, TemporalGist preserves the original content in cold
     * storage before overwriting with the gist. Enables on-demand rehydration
     * via `CognitiveMemoryManager.rehydrate()`.
     *
     * @default undefined (no archive — gist is destructive)
     * @see {@link IMemoryArchive} — the archive contract
     */
    archive?: import('../archive/IMemoryArchive.js').IMemoryArchive;
}
export declare const DEFAULT_ENCODING_CONFIG: EncodingConfig;
export declare const DEFAULT_DECAY_CONFIG: DecayConfig;
export declare const DEFAULT_BUDGET_ALLOCATION: MemoryBudgetAllocation;
//# sourceMappingURL=config.d.ts.map