/**
 * @fileoverview Unified memory store wrapping IVectorStore + IKnowledgeGraph.
 *
 * Handles:
 * - Embedding and storing memory traces in vector store
 * - Recording as episodic memories in knowledge graph
 * - Querying with decay-aware scoring
 * - Access tracking for spaced repetition
 *
 * @module agentos/memory/store/MemoryStore
 */
import type { IVectorStore } from '../../../core/vector-store/IVectorStore.js';
import type { IEmbeddingManager } from '../../../core/embeddings/IEmbeddingManager.js';
import type { IKnowledgeGraph } from '../graph/knowledge/IKnowledgeGraph.js';
import type { MemoryTrace, MemoryType, MemoryScope, CognitiveRetrievalOptions, ScoredMemoryTrace, PartiallyRetrievedTrace } from '../../core/types.js';
import type { PADState, DecayConfig } from '../../core/config.js';
import { type RetrievalUpdateResult } from '../../core/decay/DecayModel.js';
export interface MemoryStoreConfig {
    vectorStore: IVectorStore;
    embeddingManager: IEmbeddingManager;
    knowledgeGraph: IKnowledgeGraph;
    /** Collection name prefix. @default 'cogmem' */
    collectionPrefix: string;
    /** Embedding dimension (auto-detected if possible). */
    embeddingDimension?: number;
    decayConfig?: DecayConfig;
    /** Optional cognitive mechanisms engine for retrieval-time hooks. */
    mechanismsEngine?: import('../../mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine;
    /** Optional mood provider for reconsolidation drift during recordAccess. */
    moodProvider?: () => PADState;
}
export declare class MemoryStore {
    private config;
    private decay;
    /** Cache of full MemoryTrace objects by ID. */
    private traceCache;
    /** Cache embeddings by trace ID to avoid re-generating on metadata-only updates. */
    private embeddingCache;
    /** Track concrete scopes we have seen, so retrieval never falls back to a fake wildcard scope. */
    private knownScopes;
    /** Optional cognitive mechanisms engine for retrieval-time hooks. */
    private mechanismsEngine?;
    constructor(config: MemoryStoreConfig);
    /**
     * Store a new memory trace: embed content, upsert into vector store,
     * and record as episodic memory in the knowledge graph.
     */
    store(trace: MemoryTrace): Promise<void>;
    /**
     * Query memory traces with cognitive scoring.
     */
    query(queryText: string, currentMood: PADState, options?: CognitiveRetrievalOptions): Promise<{
        scored: ScoredMemoryTrace[];
        partial: PartiallyRetrievedTrace[];
    }>;
    /**
     * Record that a memory was accessed (retrieved).
     * Updates decay parameters via spaced repetition.
     */
    recordAccess(traceId: string): Promise<RetrievalUpdateResult | null>;
    /**
     * Get all traces for a scope (for consolidation pipeline).
     *
     * **Limitation**: This primarily returns traces from the in-process cache.
     * Traces that were persisted to the vector store in a prior process lifetime
     * (or by another process) will only be returned if the cache is empty for this
     * scope, in which case we fall back to querying the vector store with a
     * zero-vector and metadata filter. The fallback is approximate (limited by
     * topK) and does not guarantee completeness.
     */
    getByScope(scope: MemoryScope, scopeId: string, type?: MemoryType): Promise<MemoryTrace[]>;
    /**
     * Soft-delete a trace.
     */
    softDelete(traceId: string): Promise<void>;
    /**
     * Get a trace by ID.
     */
    getTrace(traceId: string): MemoryTrace | undefined;
    /**
     * Get trace count.
     */
    getTraceCount(): number;
    /**
     * Get active trace count.
     */
    getActiveTraceCount(): number;
    /**
     * List cached traces for diagnostics and tooling.
     */
    listTraces(options?: {
        activeOnly?: boolean;
        type?: MemoryType;
        scope?: MemoryScope;
        scopeId?: string;
    }): MemoryTrace[];
    private registerScope;
    private getKnownScopes;
}
//# sourceMappingURL=MemoryStore.d.ts.map