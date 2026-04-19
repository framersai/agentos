import type { RetrievalConfidenceSummary } from '../../rag/unified/confidence.js';
import type { MemoryRetrievalPolicy, MemoryRetrievalProfile } from '../../rag/unified/policy.js';
/**
 * @fileoverview Core types for the Cognitive Memory System.
 *
 * Grounded in cognitive science models:
 * - Atkinson-Shiffrin (sensory → STM → LTM)
 * - Baddeley's working memory (slot-based, capacity-limited)
 * - Tulving's LTM taxonomy (episodic vs semantic)
 * - Ebbinghaus forgetting curve (strength decay over time)
 * - PAD emotional model (valence/arousal/dominance tagging)
 *
 * @module agentos/memory/types
 */
/** Long-term memory subtypes (Tulving's taxonomy + extensions). */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'prospective' | 'relational';
/** Visibility / ownership scope for a memory trace. */
export type MemoryScope = 'thread' | 'user' | 'persona' | 'organization';
/** How the content of this memory was originally produced. */
export type MemorySourceType = 'user_statement' | 'agent_inference' | 'tool_result' | 'observation' | 'reflection' | 'external';
export interface MemoryProvenance {
    sourceType: MemorySourceType;
    /** Back-reference to originating conversation, tool call, etc. */
    sourceId?: string;
    /** Timestamp of the original source information. */
    sourceTimestamp: number;
    /** 0-1 confidence we have in this memory's accuracy. */
    confidence: number;
    /** How many times this memory has been externally confirmed. */
    verificationCount: number;
    lastVerifiedAt?: number;
    /** IDs of other traces that contradict this one. */
    contradictedBy?: string[];
}
export interface EmotionalContext {
    /** Pleasure / valence dimension, -1 (negative) to 1 (positive). */
    valence: number;
    /** Arousal dimension, 0 (calm) to 1 (excited). */
    arousal: number;
    /** Dominance dimension, -1 (submissive) to 1 (dominant). */
    dominance: number;
    /** Derived emotional intensity: |valence| * arousal. */
    intensity: number;
    /** GMIMood enum string at encoding time. */
    gmiMood: string;
}
export interface ContentFeatures {
    hasNovelty: boolean;
    hasProcedure: boolean;
    hasEmotion: boolean;
    hasSocialContent: boolean;
    hasCooperation: boolean;
    hasEthicalContent: boolean;
    hasContradiction: boolean;
    /** 0-1 relevance to current task / active goal. */
    topicRelevance: number;
}
export interface MemoryTrace {
    id: string;
    type: MemoryType;
    scope: MemoryScope;
    scopeId: string;
    content: string;
    structuredData?: Record<string, unknown>;
    entities: string[];
    tags: string[];
    provenance: MemoryProvenance;
    emotionalContext: EmotionalContext;
    /** S_0: initial encoding strength, set at creation. */
    encodingStrength: number;
    /** Optional normalized salience score used by some consolidation/retrieval paths. */
    importance?: number;
    /** Time constant (ms); grows with each successful retrieval. */
    stability: number;
    /** Number of times this trace has been successfully retrieved. */
    retrievalCount: number;
    /** Unix ms of last retrieval. */
    lastAccessedAt: number;
    /** Total access count (includes non-retrieval touches). */
    accessCount: number;
    /** Current interval (ms); doubles on each successful recall. */
    reinforcementInterval: number;
    /** When this memory is next due for reinforcement review. */
    nextReinforcementAt?: number;
    associatedTraceIds: string[];
    createdAt: number;
    updatedAt: number;
    consolidatedAt?: number;
    isActive: boolean;
}
export interface WorkingMemorySlot {
    slotId: string;
    /** Reference to the underlying MemoryTrace (or a transient key). */
    traceId: string;
    /** 0-1 activation level; determines if slot is "in focus". */
    activationLevel: number;
    /** When this trace entered working memory (Unix ms). */
    enteredAt: number;
    /** Maintenance rehearsal counter. */
    rehearsalCount: number;
    /** How much attention is allocated to this slot (0-1). */
    attentionWeight: number;
}
export interface EncodingWeights {
    noveltyAttention: number;
    proceduralAttention: number;
    emotionalSensitivity: number;
    socialAttention: number;
    cooperativeAttention: number;
    ethicalAttention: number;
}
export interface EncodingResult {
    initialStrength: number;
    stability: number;
    importance: number;
    isFlashbulb: boolean;
}
export interface CognitiveRetrievalOptions {
    topK?: number;
    types?: MemoryType[];
    scopes?: Array<{
        scope: MemoryScope;
        scopeId: string;
    }>;
    tags?: string[];
    entities?: string[];
    minConfidence?: number;
    timeRange?: {
        after?: number;
        before?: number;
    };
    /** If true, skip emotional congruence bias (useful for factual lookups). */
    neutralMood?: boolean;
    /**
     * Enable HyDE (Hypothetical Document Embedding) for memory retrieval.
     *
     * When `true` and a HyDE retriever is configured on the memory manager,
     * the system generates a hypothetical memory trace matching the query
     * before embedding. This produces embeddings that are closer to actual
     * stored memories, improving recall — especially for vague or abstract
     * recall prompts (e.g. "that thing we discussed about deployment").
     *
     * Adds one LLM call per retrieval. Use for important lookups where
     * recall quality matters more than latency.
     *
     * @default false
     */
    hyde?: boolean;
    /** Shared retrieval profile and confidence policy. */
    policy?: MemoryRetrievalPolicy;
    /**
     * Override the 6-signal retrieval weights for this call. Missing
     * keys fall back to {@link DEFAULT_SCORING_WEIGHTS}. Useful for
     * ablation studies (zero one weight at a time and measure
     * Δaccuracy) and for A/B testing alternate weight configurations
     * without mutating global defaults.
     */
    scoringWeights?: Partial<import('./decay/RetrievalPriorityScorer.js').ScoringWeights>;
}
export interface ScoredMemoryTrace extends MemoryTrace {
    /** Composite retrieval score (0-1). */
    retrievalScore: number;
    /** Individual score components for debugging. */
    scoreBreakdown: {
        strengthScore: number;
        similarityScore: number;
        recencyScore: number;
        emotionalCongruenceScore: number;
        graphActivationScore: number;
        importanceScore: number;
    };
}
export interface PartiallyRetrievedTrace {
    traceId: string;
    confidence: number;
    partialContent: string;
    suggestedCues: string[];
}
export interface CognitiveRetrievalResult {
    retrieved: ScoredMemoryTrace[];
    partiallyRetrieved: PartiallyRetrievedTrace[];
    diagnostics: {
        candidatesScanned: number;
        vectorSearchTimeMs: number;
        scoringTimeMs: number;
        totalTimeMs: number;
        policyProfile?: MemoryRetrievalProfile;
        suppressed?: 'weak_hits';
        confidence?: RetrievalConfidenceSummary;
        escalations?: string[];
    };
}
export interface MemoryBudgetAllocation {
    workingMemory: number;
    semanticRecall: number;
    recentEpisodic: number;
    prospectiveAlerts: number;
    graphAssociations: number;
    observationNotes: number;
    persistentMemory: number;
}
export interface AssembledMemoryContext {
    contextText: string;
    tokensUsed: number;
    allocation: MemoryBudgetAllocation;
    includedMemoryIds: string[];
}
export interface MemoryHealthReport {
    totalTraces: number;
    activeTraces: number;
    avgStrength: number;
    weakestTraceStrength: number;
    workingMemoryUtilization: number;
    lastConsolidationAt?: number;
    tracesPerType: Record<MemoryType, number>;
    tracesPerScope: Record<MemoryScope, number>;
}
/**
 * Serializable snapshot of the full memory graph for visualization.
 * Contains nodes (traces), edges (associations), clusters, and aggregate stats.
 * Used by wilds-ai companion sidebar, memory graph view, and devtools.
 */
export interface MemoryGraphSnapshot {
    nodes: Array<{
        id: string;
        type: MemoryType;
        content: string;
        strength: number;
        isFlashbulb: boolean;
        createdAt: number;
        lastAccessedAt: number;
        retrievalCount: number;
    }>;
    edges: Array<{
        sourceId: string;
        targetId: string;
        type: string;
        weight: number;
    }>;
    clusters: Array<{
        clusterId: string;
        memberIds: string[];
        density: number;
    }>;
    stats: {
        nodeCount: number;
        edgeCount: number;
        clusterCount: number;
    };
}
/**
 * Observation pipeline health stats for devtools/monitoring.
 * Exposes the state of the 3-tier pipeline: notes → compressed → reflected.
 */
export interface ObservationPipelineStats {
    /** Number of raw observation notes pending compression. */
    pendingNotes: number;
    /** Number of compressed observations pending reflection. */
    pendingCompressed: number;
    /** Total observation notes produced since initialization. */
    totalNotesProduced: number;
    /** Total reflection cycles completed. */
    totalReflectionsProduced: number;
    /** Timestamp of last reflection cycle, or null if none. */
    lastReflectionAt: number | null;
    /** Average compression ratio (input tokens / output tokens). */
    avgCompressionRatio: number;
}
/**
 * Full exportable memory state for character portability across worlds.
 * Used for companion export/import in wilds-ai.
 */
export interface CognitiveMemorySnapshot {
    /** Snapshot format version. */
    version: string;
    /** Agent/entity ID that owns this memory. */
    agentId: string;
    /** All active memory traces. */
    traces: MemoryTrace[];
    /** Graph edges between traces. */
    graphEdges: Array<{
        sourceId: string;
        targetId: string;
        type: string;
        weight: number;
        createdAt: number;
    }>;
    /** Active prospective memory items. */
    prospectiveItems: Array<{
        id: string;
        content: string;
        triggerType: string;
        importance: number;
        triggered: boolean;
        createdAt: number;
    }>;
    /** Snapshot metadata for import validation. */
    metadata: {
        exportedAt: number;
        traceCount: number;
        typeDistribution: Record<MemoryType, number>;
    };
}
/** Strength distribution stats per memory type. */
export interface MemoryTypeStats {
    /** Total traces of this type. */
    count: number;
    /** Average encoding strength across traces. */
    avgStrength: number;
    /** Number of traces below 0.3 strength (fading). */
    decaying: number;
    /** Number of flashbulb-strength traces (above 0.8). */
    flashbulb: number;
}
export type { EmbeddingConfig, ExtendedConsolidationConfig, IngestionConfig, MemoryConfig, RememberOptions, RecallOptions, IngestOptions, IngestResult, ExportOptions, ImportOptions, ImportResult, ConsolidationResult, MemoryHealth, LoadOptions, LoadedDocument, DocumentMetadata, DocumentChunk, ExtractedImage, ExtractedTable, } from '../io/facade/types.js';
export type { CompactionEntry, CompactionInput, CompactionResult, ContextMessage, ICompactionStrategy, InfiniteContextConfig, SummaryChainNode, } from '../pipeline/context/types.js';
//# sourceMappingURL=types.d.ts.map