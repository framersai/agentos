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
import { DEFAULT_DECAY_CONFIG } from '../../core/config.js';
import { updateOnRetrieval, } from '../../core/decay/DecayModel.js';
import { scoreAndRankTraces, detectPartiallyRetrieved, } from '../../core/decay/RetrievalPriorityScorer.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function collectionName(prefix, scope, scopeId) {
    return `${prefix}_${scope}_${scopeId}`;
}
function scopeKey(scope, scopeId) {
    return `${scope}:${scopeId}`;
}
function traceToMetadata(trace) {
    return {
        type: trace.type,
        scope: trace.scope,
        scopeId: trace.scopeId,
        encodingStrength: trace.encodingStrength,
        stability: trace.stability,
        retrievalCount: trace.retrievalCount,
        lastAccessedAt: trace.lastAccessedAt,
        accessCount: trace.accessCount,
        emotionalValence: trace.emotionalContext.valence,
        emotionalArousal: trace.emotionalContext.arousal,
        emotionalIntensity: trace.emotionalContext.intensity,
        confidence: trace.provenance.confidence,
        sourceType: trace.provenance.sourceType,
        importance: trace.provenance.confidence, // use confidence as proxy
        createdAt: trace.createdAt,
        isActive: trace.isActive ? 1 : 0,
        tags: trace.tags.join(','),
        entities: trace.entities.join(','),
    };
}
function metadataToTracePartial(metadata) {
    return {
        type: metadata.type,
        scope: metadata.scope,
        scopeId: metadata.scopeId,
        encodingStrength: metadata.encodingStrength,
        stability: metadata.stability,
        retrievalCount: metadata.retrievalCount,
        lastAccessedAt: metadata.lastAccessedAt,
        accessCount: metadata.accessCount,
        emotionalContext: {
            valence: metadata.emotionalValence,
            arousal: metadata.emotionalArousal,
            dominance: 0,
            intensity: metadata.emotionalIntensity,
            gmiMood: '',
        },
        provenance: {
            sourceType: metadata.sourceType,
            confidence: metadata.confidence,
            verificationCount: 0,
            sourceTimestamp: metadata.createdAt,
        },
        createdAt: metadata.createdAt,
        isActive: metadata.isActive === 1,
        tags: typeof metadata.tags === 'string' ? metadata.tags.split(',').filter(Boolean) : [],
        entities: typeof metadata.entities === 'string' ? metadata.entities.split(',').filter(Boolean) : [],
    };
}
// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------
export class MemoryStore {
    constructor(config) {
        /** Cache of full MemoryTrace objects by ID. */
        this.traceCache = new Map();
        /** Cache embeddings by trace ID to avoid re-generating on metadata-only updates. */
        this.embeddingCache = new Map();
        /** Track concrete scopes we have seen, so retrieval never falls back to a fake wildcard scope. */
        this.knownScopes = new Map();
        /**
         * Optional SqliteBrain for durable write-through persistence.
         * When set, store/softDelete/recordAccess also write to the brain's SQL tables.
         * The in-memory vector index remains the hot read path (fast); the brain is
         * the durable backing store that survives process restarts.
         */
        this.brain = null;
        this.config = config;
        this.decay = config.decayConfig ?? DEFAULT_DECAY_CONFIG;
        this.mechanismsEngine = config.mechanismsEngine;
    }
    /**
     * Attach a SqliteBrain for durable write-through persistence.
     * Once attached, all store/softDelete/recordAccess operations also
     * write to the brain's `memory_traces` table.
     *
     * @param brain - SqliteBrain instance (already initialized with schema)
     */
    setBrain(brain) {
        this.brain = brain;
    }
    /**
     * Access the attached SqliteBrain for export/import operations.
     * Returns null when no brain is attached (in-memory only mode).
     */
    getBrain() {
        return this.brain;
    }
    // =========================================================================
    // Store
    // =========================================================================
    /**
     * Store a new memory trace: embed content, upsert into vector store,
     * and record as episodic memory in the knowledge graph.
     */
    async store(trace) {
        const collection = collectionName(this.config.collectionPrefix, trace.scope, trace.scopeId);
        // Generate embedding
        const embeddingResponse = await this.config.embeddingManager.generateEmbeddings({
            texts: trace.content,
        });
        const embedding = embeddingResponse.embeddings[0];
        try {
            const exists = this.config.vectorStore.collectionExists
                ? await this.config.vectorStore.collectionExists(collection)
                : true;
            if (!exists) {
                await this.config.vectorStore.createCollection?.(collection, this.config.embeddingDimension ?? embedding.length, { overwriteIfExists: false });
            }
        }
        catch {
            // Some providers auto-create collections or do not expose existence checks reliably.
        }
        // Upsert into vector store
        const doc = {
            id: trace.id,
            textContent: trace.content,
            embedding,
            metadata: traceToMetadata(trace),
        };
        await this.config.vectorStore.upsert(collection, [doc]);
        // Record in knowledge graph as episodic memory
        try {
            await this.config.knowledgeGraph.recordMemory({
                type: trace.type === 'episodic' ? 'conversation' : 'discovery',
                summary: trace.content.substring(0, 200),
                description: trace.content,
                participants: [trace.scopeId],
                valence: trace.emotionalContext.valence,
                importance: trace.encodingStrength,
                entityIds: [],
                embedding,
                occurredAt: new Date(trace.createdAt).toISOString(),
                outcome: 'unknown',
                context: {
                    memoryTraceId: trace.id,
                    scope: trace.scope,
                    scopeId: trace.scopeId,
                    type: trace.type,
                },
            });
        }
        catch {
            // Knowledge graph may not be available; non-critical
        }
        // Cache trace and its embedding (avoids re-generation on recordAccess)
        this.traceCache.set(trace.id, trace);
        this.embeddingCache.set(trace.id, embedding);
        this.registerScope(trace.scope, trace.scopeId);
        // Write-through to SqliteBrain for durability.
        // The SQL row mirrors the in-memory cache so traces survive restart.
        if (this.brain) {
            try {
                await this.brain.run(`INSERT OR REPLACE INTO memory_traces (id, type, scope, content, embedding, strength, created_at, last_accessed, retrieval_count, tags, emotions, metadata, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, [
                    trace.id,
                    trace.type,
                    trace.scope,
                    trace.content,
                    null, // embedding managed by vector store, not SQL
                    trace.encodingStrength,
                    trace.createdAt,
                    trace.lastAccessedAt,
                    trace.retrievalCount,
                    JSON.stringify(trace.tags),
                    JSON.stringify(trace.emotionalContext),
                    JSON.stringify({
                        scopeId: trace.scopeId,
                        provenance: trace.provenance,
                        entities: trace.entities,
                        stability: trace.stability,
                        importance: trace.importance,
                        associatedTraceIds: trace.associatedTraceIds,
                        structuredData: trace.structuredData,
                    }),
                ]);
            }
            catch {
                // Write-through is best-effort — in-memory store is primary
            }
        }
    }
    // =========================================================================
    // Query
    // =========================================================================
    /**
     * Query memory traces with cognitive scoring.
     */
    async query(queryText, currentMood, options = {}) {
        const now = Date.now();
        const topK = options.topK ?? 20;
        // Determine which collections to search
        const scopes = options.scopes?.length ? options.scopes : this.getKnownScopes();
        if (scopes.length === 0) {
            return { scored: [], partial: [] };
        }
        // Generate query embedding
        const embeddingResponse = await this.config.embeddingManager.generateEmbeddings({
            texts: queryText,
        });
        const queryEmbedding = embeddingResponse.embeddings[0];
        // Build metadata filter
        const metadataFilter = { isActive: { $eq: 1 } };
        if (options.types?.length) {
            metadataFilter.type = { $in: options.types };
        }
        if (options.minConfidence != null) {
            metadataFilter.confidence = { $gte: options.minConfidence };
        }
        if (options.timeRange?.after) {
            metadataFilter.createdAt = { $gte: options.timeRange.after };
        }
        // Search across scopes
        const allCandidates = [];
        for (const { scope, scopeId } of scopes) {
            const collection = collectionName(this.config.collectionPrefix, scope, scopeId);
            try {
                const results = await this.config.vectorStore.query(collection, queryEmbedding, {
                    topK: topK * 2, // over-fetch for re-ranking
                    filter: metadataFilter,
                    includeMetadata: true,
                });
                for (const result of results.documents) {
                    const tracePartial = metadataToTracePartial(result.metadata ?? {});
                    const cached = this.traceCache.get(result.id);
                    const trace = cached ??
                        {
                            id: result.id,
                            content: result.textContent ?? '',
                            structuredData: undefined,
                            associatedTraceIds: [],
                            reinforcementInterval: 3600000,
                            updatedAt: Date.now(),
                            ...tracePartial,
                        };
                    if (!cached) {
                        this.traceCache.set(trace.id, trace);
                    }
                    if (trace.scope && trace.scopeId) {
                        this.registerScope(trace.scope, trace.scopeId);
                    }
                    allCandidates.push({
                        trace,
                        vectorSimilarity: result.similarityScore ?? 0,
                        graphActivation: 0, // Batch 2
                    });
                }
            }
            catch {
                // Collection may not exist yet; skip
            }
        }
        // Score and rank
        const scoringContext = {
            currentMood,
            now,
            neutralMood: options.neutralMood,
            decayConfig: this.decay,
        };
        const scored = scoreAndRankTraces(allCandidates, scoringContext).slice(0, topK);
        const partial = detectPartiallyRetrieved(allCandidates, now);
        // Cognitive mechanisms: RIF + FOK
        if (this.mechanismsEngine && scored.length > 0) {
            const cutoff = scored[scored.length - 1].retrievalScore;
            this.mechanismsEngine.onRetrieval(scored, allCandidates, cutoff, []);
        }
        return { scored, partial };
    }
    // =========================================================================
    // Access tracking
    // =========================================================================
    /**
     * Record that a memory was accessed (retrieved).
     * Updates decay parameters via spaced repetition.
     */
    async recordAccess(traceId) {
        const trace = this.traceCache.get(traceId);
        if (!trace)
            return null;
        const now = Date.now();
        const update = updateOnRetrieval(trace, now);
        // Apply updates to cached trace
        trace.encodingStrength = update.encodingStrength;
        trace.stability = update.stability;
        trace.retrievalCount = update.retrievalCount;
        trace.lastAccessedAt = update.lastAccessedAt;
        trace.accessCount = update.accessCount;
        trace.reinforcementInterval = update.reinforcementInterval;
        trace.nextReinforcementAt = update.nextReinforcementAt;
        trace.updatedAt = now;
        // Cognitive mechanisms: reconsolidation drift on access
        if (this.mechanismsEngine && this.config.moodProvider) {
            const mood = this.config.moodProvider();
            this.mechanismsEngine.onAccess(trace, mood);
        }
        // Update vector store metadata, reusing cached embedding to avoid
        // wasteful re-embedding on every access.
        const collection = collectionName(this.config.collectionPrefix, trace.scope, trace.scopeId);
        try {
            let embedding = this.embeddingCache.get(trace.id);
            if (!embedding) {
                // Embedding not cached (e.g. loaded from a prior process). Generate once and cache.
                const embeddingResponse = await this.config.embeddingManager.generateEmbeddings({
                    texts: trace.content,
                });
                embedding = embeddingResponse.embeddings[0];
                this.embeddingCache.set(trace.id, embedding);
            }
            await this.config.vectorStore.upsert(collection, [
                {
                    id: trace.id,
                    textContent: trace.content,
                    embedding,
                    metadata: traceToMetadata(trace),
                },
            ]);
        }
        catch {
            // Non-critical update
        }
        // Write-through: update access metadata in the durable SQL store
        if (this.brain) {
            try {
                await this.brain.run('UPDATE memory_traces SET last_accessed = ?, retrieval_count = ?, strength = ? WHERE id = ?', [trace.lastAccessedAt, trace.retrievalCount, trace.encodingStrength, traceId]);
            }
            catch {
                // Best-effort persistence
            }
        }
        return update;
    }
    // =========================================================================
    // Batch operations
    // =========================================================================
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
    async getByScope(scope, scopeId, type) {
        // Return from cache + filter
        const results = [];
        for (const trace of this.traceCache.values()) {
            if (trace.scope === scope && trace.scopeId === scopeId) {
                if (!type || trace.type === type) {
                    results.push(trace);
                }
            }
        }
        // Fallback: if cache is empty for this scope, query the vector store.
        if (results.length === 0) {
            try {
                const collection = collectionName(this.config.collectionPrefix, scope, scopeId);
                const dim = this.config.embeddingDimension ?? 1536;
                const zeroVector = new Array(dim).fill(0);
                const filter = { isActive: 1 };
                if (type) {
                    filter.type = type;
                }
                const queryResult = await this.config.vectorStore.query(collection, zeroVector, {
                    topK: 500,
                    filter,
                    includeMetadata: true,
                    includeTextContent: true,
                });
                for (const doc of queryResult.documents) {
                    if (!doc.metadata)
                        continue;
                    const cached = this.traceCache.get(doc.id);
                    if (cached) {
                        results.push(cached);
                    }
                    else {
                        // Reconstruct trace from vector store metadata.
                        const partial = metadataToTracePartial(doc.metadata);
                        const trace = {
                            id: doc.id,
                            content: doc.textContent ?? '',
                            associatedTraceIds: [],
                            reinforcementInterval: 0,
                            updatedAt: partial.createdAt ?? Date.now(),
                            ...partial,
                        };
                        this.traceCache.set(trace.id, trace);
                        results.push(trace);
                    }
                }
            }
            catch {
                // Vector store query may fail (collection not found, etc.); return empty.
            }
        }
        return results;
    }
    /**
     * Soft-delete a trace.
     */
    async softDelete(traceId) {
        const trace = this.traceCache.get(traceId);
        if (trace) {
            trace.isActive = false;
            trace.updatedAt = Date.now();
        }
        // Write-through: mark trace as deleted in the durable SQL store
        if (this.brain) {
            try {
                await this.brain.run('UPDATE memory_traces SET deleted = 1 WHERE id = ?', [traceId]);
            }
            catch {
                // Best-effort persistence
            }
        }
    }
    /**
     * Get a trace by ID.
     */
    getTrace(traceId) {
        return this.traceCache.get(traceId);
    }
    /**
     * Get trace count.
     */
    getTraceCount() {
        return this.traceCache.size;
    }
    /**
     * Get active trace count.
     */
    getActiveTraceCount() {
        let count = 0;
        for (const trace of this.traceCache.values()) {
            if (trace.isActive)
                count++;
        }
        return count;
    }
    /**
     * List cached traces for diagnostics and tooling.
     */
    listTraces(options) {
        const traces = [];
        for (const trace of this.traceCache.values()) {
            if (options?.activeOnly && !trace.isActive) {
                continue;
            }
            if (options?.type && trace.type !== options.type) {
                continue;
            }
            if (options?.scope && trace.scope !== options.scope) {
                continue;
            }
            if (options?.scopeId && trace.scopeId !== options.scopeId) {
                continue;
            }
            traces.push({ ...trace });
        }
        return traces.sort((a, b) => b.createdAt - a.createdAt);
    }
    registerScope(scope, scopeId) {
        if (!scopeId)
            return;
        this.knownScopes.set(scopeKey(scope, scopeId), { scope, scopeId });
    }
    getKnownScopes() {
        return [...this.knownScopes.values()];
    }
}
//# sourceMappingURL=MemoryStore.js.map