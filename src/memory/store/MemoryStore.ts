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
} from '../../rag/IVectorStore.js';
import type { IEmbeddingManager } from '../../rag/IEmbeddingManager.js';
import type { IKnowledgeGraph } from '../../core/knowledge/IKnowledgeGraph.js';
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
  /** Track concrete scopes we have seen, so retrieval never falls back to a fake wildcard scope. */
  private knownScopes: Map<string, { scope: MemoryScope; scopeId: string }> = new Map();

  constructor(config: MemoryStoreConfig) {
    this.config = config;
    this.decay = config.decayConfig ?? DEFAULT_DECAY_CONFIG;
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

    // Cache
    this.traceCache.set(trace.id, trace);
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

    // Update vector store metadata
    const collection = collectionName(this.config.collectionPrefix, trace.scope, trace.scopeId);
    try {
      const embeddingResponse = await this.config.embeddingManager.generateEmbeddings({
        texts: trace.content,
      });
      await this.config.vectorStore.upsert(collection, [
        {
          id: trace.id,
          textContent: trace.content,
          embedding: embeddingResponse.embeddings[0],
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

  private registerScope(scope: MemoryScope, scopeId: string): void {
    if (!scopeId) return;
    this.knownScopes.set(scopeKey(scope, scopeId), { scope, scopeId });
  }

  private getKnownScopes(): Array<{ scope: MemoryScope; scopeId: string }> {
    return [...this.knownScopes.values()];
  }
}
