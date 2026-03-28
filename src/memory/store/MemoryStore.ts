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

import type {
  IVectorStore,
  VectorDocument,
  QueryOptions,
  MetadataFilter,
} from '../../core/vector-store/IVectorStore.js';
import type { IEmbeddingManager } from '../../core/embeddings/IEmbeddingManager.js';
import type { IKnowledgeGraph } from '../../knowledge/IKnowledgeGraph.js';
import type {
  MemoryTrace,
  MemoryType,
  MemoryScope,
  CognitiveRetrievalOptions,
  ScoredMemoryTrace,
  PartiallyRetrievedTrace,
} from '../types.js';
import type { PADState, DecayConfig } from '../config.js';
import { DEFAULT_DECAY_CONFIG } from '../config.js';
import {
  computeCurrentStrength,
  updateOnRetrieval,
  type RetrievalUpdateResult,
} from '../decay/DecayModel.js';
import {
  scoreAndRankTraces,
  detectPartiallyRetrieved,
  type CandidateTrace,
  type ScoringContext,
} from '../decay/RetrievalPriorityScorer.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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
  mechanismsEngine?: import('../mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine;
  /** Optional mood provider for reconsolidation drift during recordAccess. */
  moodProvider?: () => PADState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectionName(prefix: string, scope: MemoryScope, scopeId: string): string {
  return `${prefix}_${scope}_${scopeId}`;
}

function scopeKey(scope: MemoryScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

function traceToMetadata(trace: MemoryTrace): Record<string, any> {
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

function metadataToTracePartial(metadata: Record<string, any>): Partial<MemoryTrace> {
  return {
    type: metadata.type as MemoryType,
    scope: metadata.scope as MemoryScope,
    scopeId: metadata.scopeId as string,
    encodingStrength: metadata.encodingStrength as number,
    stability: metadata.stability as number,
    retrievalCount: metadata.retrievalCount as number,
    lastAccessedAt: metadata.lastAccessedAt as number,
    accessCount: metadata.accessCount as number,
    emotionalContext: {
      valence: metadata.emotionalValence as number,
      arousal: metadata.emotionalArousal as number,
      dominance: 0,
      intensity: metadata.emotionalIntensity as number,
      gmiMood: '',
    },
    provenance: {
      sourceType: metadata.sourceType as any,
      confidence: metadata.confidence as number,
      verificationCount: 0,
      sourceTimestamp: metadata.createdAt as number,
    },
    createdAt: metadata.createdAt as number,
    isActive: metadata.isActive === 1,
    tags: typeof metadata.tags === 'string' ? metadata.tags.split(',').filter(Boolean) : [],
    entities:
      typeof metadata.entities === 'string' ? metadata.entities.split(',').filter(Boolean) : [],
  };
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  private config: MemoryStoreConfig;
  private decay: DecayConfig;
  /** Cache of full MemoryTrace objects by ID. */
  private traceCache: Map<string, MemoryTrace> = new Map();
  /** Cache embeddings by trace ID to avoid re-generating on metadata-only updates. */
  private embeddingCache: Map<string, number[]> = new Map();
  /** Track concrete scopes we have seen, so retrieval never falls back to a fake wildcard scope. */
  private knownScopes: Map<string, { scope: MemoryScope; scopeId: string }> = new Map();
  /** Optional cognitive mechanisms engine for retrieval-time hooks. */
  private mechanismsEngine?: import('../mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine;

  constructor(config: MemoryStoreConfig) {
    this.config = config;
    this.decay = config.decayConfig ?? DEFAULT_DECAY_CONFIG;
    this.mechanismsEngine = config.mechanismsEngine;
  }

  // =========================================================================
  // Store
  // =========================================================================

  /**
   * Store a new memory trace: embed content, upsert into vector store,
   * and record as episodic memory in the knowledge graph.
   */
  async store(trace: MemoryTrace): Promise<void> {
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
        await this.config.vectorStore.createCollection?.(
          collection,
          this.config.embeddingDimension ?? embedding.length,
          { overwriteIfExists: false },
        );
      }
    } catch {
      // Some providers auto-create collections or do not expose existence checks reliably.
    }

    // Upsert into vector store
    const doc: VectorDocument = {
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
    } catch {
      // Knowledge graph may not be available; non-critical
    }

    // Cache trace and its embedding (avoids re-generation on recordAccess)
    this.traceCache.set(trace.id, trace);
    this.embeddingCache.set(trace.id, embedding);
    this.registerScope(trace.scope, trace.scopeId);
  }

  // =========================================================================
  // Query
  // =========================================================================

  /**
   * Query memory traces with cognitive scoring.
   */
  async query(
    queryText: string,
    currentMood: PADState,
    options: CognitiveRetrievalOptions = {}
  ): Promise<{ scored: ScoredMemoryTrace[]; partial: PartiallyRetrievedTrace[] }> {
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
    const metadataFilter: Record<string, any> = { isActive: { $eq: 1 } };
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
    const allCandidates: CandidateTrace[] = [];

    for (const { scope, scopeId } of scopes) {
      const collection = collectionName(this.config.collectionPrefix, scope, scopeId);

      try {
        const results = await this.config.vectorStore.query(collection, queryEmbedding, {
          topK: topK * 2, // over-fetch for re-ranking
          filter: metadataFilter as MetadataFilter,
          includeMetadata: true,
        });

        for (const result of results.documents) {
          const tracePartial = metadataToTracePartial(result.metadata ?? {});
          const cached = this.traceCache.get(result.id);

          const trace: MemoryTrace =
            cached ??
            ({
              id: result.id,
              content: result.textContent ?? '',
              structuredData: undefined,
              associatedTraceIds: [],
              reinforcementInterval: 3_600_000,
              updatedAt: Date.now(),
              ...tracePartial,
            } as MemoryTrace);

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
      } catch {
        // Collection may not exist yet; skip
      }
    }

    // Score and rank
    const scoringContext: ScoringContext = {
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
  async recordAccess(traceId: string): Promise<RetrievalUpdateResult | null> {
    const trace = this.traceCache.get(traceId);
    if (!trace) return null;

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
    } catch {
      // Non-critical update
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
  async getByScope(scope: MemoryScope, scopeId: string, type?: MemoryType): Promise<MemoryTrace[]> {
    // Return from cache + filter
    const results: MemoryTrace[] = [];
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
        const filter: MetadataFilter = { isActive: 1 };
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
          if (!doc.metadata) continue;
          const cached = this.traceCache.get(doc.id);
          if (cached) {
            results.push(cached);
          } else {
            // Reconstruct trace from vector store metadata.
            const partial = metadataToTracePartial(doc.metadata as Record<string, any>);
            const trace: MemoryTrace = {
              id: doc.id,
              content: doc.textContent ?? '',
              associatedTraceIds: [],
              reinforcementInterval: 0,
              updatedAt: (partial.createdAt as number) ?? Date.now(),
              ...partial,
            } as MemoryTrace;
            this.traceCache.set(trace.id, trace);
            results.push(trace);
          }
        }
      } catch {
        // Vector store query may fail (collection not found, etc.); return empty.
      }
    }

    return results;
  }

  /**
   * Soft-delete a trace.
   */
  async softDelete(traceId: string): Promise<void> {
    const trace = this.traceCache.get(traceId);
    if (trace) {
      trace.isActive = false;
      trace.updatedAt = Date.now();
    }
  }

  /**
   * Get a trace by ID.
   */
  getTrace(traceId: string): MemoryTrace | undefined {
    return this.traceCache.get(traceId);
  }

  /**
   * Get trace count.
   */
  getTraceCount(): number {
    return this.traceCache.size;
  }

  /**
   * Get active trace count.
   */
  getActiveTraceCount(): number {
    let count = 0;
    for (const trace of this.traceCache.values()) {
      if (trace.isActive) count++;
    }
    return count;
  }

  /**
   * List cached traces for diagnostics and tooling.
   */
  listTraces(options?: {
    activeOnly?: boolean;
    type?: MemoryType;
    scope?: MemoryScope;
    scopeId?: string;
  }): MemoryTrace[] {
    const traces: MemoryTrace[] = [];
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

  private registerScope(scope: MemoryScope, scopeId: string): void {
    if (!scopeId) return;
    this.knownScopes.set(scopeKey(scope, scopeId), { scope, scopeId });
  }

  private getKnownScopes(): Array<{ scope: MemoryScope; scopeId: string }> {
    return [...this.knownScopes.values()];
  }
}
