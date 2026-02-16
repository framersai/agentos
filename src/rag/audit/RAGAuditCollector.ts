/**
 * @fileoverview Request-scoped collector that accumulates RAG operations during
 * a single retrieval pipeline execution and produces a finalized RAGAuditTrail.
 *
 * Usage:
 * ```typescript
 * const collector = new RAGAuditCollector({ requestId: 'req-1', query: 'What is ML?' });
 *
 * const embedOp = collector.startOperation('embedding');
 * // ... do embedding work ...
 * embedOp.setTokenUsage({ embeddingTokens: 512, llmPromptTokens: 0, llmCompletionTokens: 0, totalTokens: 512 });
 * embedOp.complete(1);
 *
 * const trail = collector.finalize();
 * ```
 *
 * @module @framers/agentos/rag/audit
 */

import type {
  RAGAuditTrail,
  RAGOperationEntry,
  RAGSourceAttribution,
} from './RAGAuditTypes.js';

let _idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

/** Minimal UsageLedger interface to avoid hard dependency on core/usage. */
interface UsageLedgerLike {
  ingestUsage(
    dim: { sessionId: string; personaId?: string; providerId?: string; modelId?: string },
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUSD?: number; isFinal?: boolean },
  ): void;
}

export interface RAGAuditCollectorOptions {
  requestId: string;
  query: string;
  seedId?: string;
  sessionId?: string;
  /** When provided, finalized audit data is pushed into the usage ledger for token/cost accounting. */
  usageLedger?: UsageLedgerLike;
}

/**
 * Fluent handle for a single in-flight RAG operation.
 * Call `.complete(resultsCount)` to finalize timing and add it to the collector.
 */
export class RAGOperationHandle {
  private readonly entry: RAGOperationEntry;
  private readonly startTime: number;
  private completed = false;
  private readonly onComplete: (entry: RAGOperationEntry) => void;

  constructor(
    type: RAGOperationEntry['operationType'],
    onComplete: (entry: RAGOperationEntry) => void,
  ) {
    this.startTime = Date.now();
    this.onComplete = onComplete;
    this.entry = {
      operationId: nextId(`op-${type}`),
      operationType: type,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      sources: [],
      tokenUsage: {
        embeddingTokens: 0,
        llmPromptTokens: 0,
        llmCompletionTokens: 0,
        totalTokens: 0,
      },
      costUSD: 0,
      resultsCount: 0,
    };
  }

  setRetrievalMethod(method: RAGOperationEntry['retrievalMethod']): this {
    this.entry.retrievalMethod = method;
    return this;
  }

  addSources(
    chunks: Array<{
      id?: string;
      chunkId?: string;
      originalDocumentId?: string;
      documentId?: string;
      content?: string;
      contentSnippet?: string;
      relevanceScore?: number;
      dataSourceId?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    }>,
  ): this {
    for (const c of chunks) {
      const chunkId = c.chunkId ?? c.id ?? 'unknown';
      const documentId = c.documentId ?? c.originalDocumentId ?? chunkId;
      this.entry.sources.push({
        chunkId,
        documentId,
        source: c.source,
        contentSnippet: c.contentSnippet ?? (c.content ?? '').slice(0, 200),
        relevanceScore: c.relevanceScore ?? 0,
        dataSourceId: c.dataSourceId,
        metadata: c.metadata,
      });
    }
    return this;
  }

  setTokenUsage(usage: RAGOperationEntry['tokenUsage']): this {
    this.entry.tokenUsage = usage;
    return this;
  }

  setCost(costUSD: number): this {
    this.entry.costUSD = costUSD;
    return this;
  }

  setDataSourceIds(ids: string[]): this {
    this.entry.dataSourceIds = ids;
    return this;
  }

  setCollectionIds(ids: string[]): this {
    this.entry.collectionIds = ids;
    return this;
  }

  setGraphDetails(details: NonNullable<RAGOperationEntry['graphDetails']>): this {
    this.entry.graphDetails = details;
    return this;
  }

  setRerankDetails(details: NonNullable<RAGOperationEntry['rerankDetails']>): this {
    this.entry.rerankDetails = details;
    return this;
  }

  /**
   * Finalizes the operation, records duration, computes relevance score stats,
   * and adds the entry to the parent collector.
   *
   * @param resultsCount Number of results this operation produced.
   * @param overrideDurationMs Optional override for duration (when timing is measured externally).
   */
  complete(resultsCount: number, overrideDurationMs?: number): RAGOperationEntry {
    if (this.completed) return this.entry;
    this.completed = true;

    this.entry.durationMs = overrideDurationMs ?? (Date.now() - this.startTime);
    this.entry.resultsCount = resultsCount;

    // Compute relevance score stats from sources
    if (this.entry.sources.length > 0) {
      const scores = this.entry.sources.map((s) => s.relevanceScore);
      this.entry.relevanceScores = {
        min: Math.min(...scores),
        max: Math.max(...scores),
        avg: scores.reduce((a, b) => a + b, 0) / scores.length,
      };
    }

    this.onComplete(this.entry);
    return this.entry;
  }
}

/**
 * Request-scoped audit collector. Create one per `retrieveContext()` call.
 * NOT a singleton — scoped to a single pipeline execution.
 */
export class RAGAuditCollector {
  private readonly options: RAGAuditCollectorOptions;
  private readonly trailId: string;
  private readonly startTime: number;
  private readonly operations: RAGOperationEntry[] = [];

  constructor(options: RAGAuditCollectorOptions) {
    this.options = options;
    this.trailId = nextId('trail');
    this.startTime = Date.now();
  }

  /** Start tracking a new operation. Returns a fluent handle. */
  startOperation(type: RAGOperationEntry['operationType']): RAGOperationHandle {
    return new RAGOperationHandle(type, (entry) => {
      this.operations.push(entry);
    });
  }

  /** Finalize and return the complete audit trail with computed summary. */
  finalize(): RAGAuditTrail {
    const totalDurationMs = Date.now() - this.startTime;

    // Aggregate totals
    let totalTokens = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalEmbeddingTokens = 0;
    let totalCostUSD = 0;
    let totalLLMCalls = 0;
    let totalEmbeddingCalls = 0;
    const operationTypes = new Set<string>();
    const uniqueDocuments = new Set<string>();
    const uniqueCollections = new Set<string>();
    const uniqueDataSources = new Set<string>();

    for (const op of this.operations) {
      operationTypes.add(op.operationType);

      totalTokens += op.tokenUsage.totalTokens;
      totalPromptTokens += op.tokenUsage.llmPromptTokens;
      totalCompletionTokens += op.tokenUsage.llmCompletionTokens;
      totalEmbeddingTokens += op.tokenUsage.embeddingTokens;
      totalCostUSD += op.costUSD;

      if (op.operationType === 'embedding') {
        totalEmbeddingCalls++;
      } else if (
        op.operationType === 'rerank' ||
        op.operationType === 'graph_local' ||
        op.operationType === 'graph_global'
      ) {
        // Graph search and reranking use LLM calls
        if (op.tokenUsage.llmPromptTokens > 0 || op.tokenUsage.llmCompletionTokens > 0) {
          totalLLMCalls++;
        }
      }

      for (const src of op.sources) {
        uniqueDocuments.add(src.documentId);
        if (src.dataSourceId) uniqueDataSources.add(src.dataSourceId);
      }
      if (op.collectionIds) {
        for (const cId of op.collectionIds) uniqueCollections.add(cId);
      }
      if (op.dataSourceIds) {
        for (const dsId of op.dataSourceIds) uniqueDataSources.add(dsId);
      }
    }

    const trail: RAGAuditTrail = {
      trailId: this.trailId,
      requestId: this.options.requestId,
      seedId: this.options.seedId,
      sessionId: this.options.sessionId,
      query: this.options.query,
      timestamp: new Date(this.startTime).toISOString(),
      operations: this.operations,
      summary: {
        totalOperations: this.operations.length,
        totalLLMCalls,
        totalEmbeddingCalls,
        totalTokens,
        totalPromptTokens,
        totalCompletionTokens,
        totalEmbeddingTokens,
        totalCostUSD,
        totalDurationMs,
        operationTypes: Array.from(operationTypes),
        sourceSummary: {
          uniqueDocuments: uniqueDocuments.size,
          uniqueCollections: uniqueCollections.size,
          uniqueDataSources: uniqueDataSources.size,
        },
      },
    };

    // Push to UsageLedger when one was provided.
    if (this.options.usageLedger && this.options.sessionId) {
      const ledger = this.options.usageLedger;
      const sessionId = this.options.sessionId;
      const personaId = this.options.seedId;

      for (const op of this.operations) {
        const providerId =
          op.operationType === 'embedding' ? 'rag-embedding'
          : op.operationType === 'rerank' ? 'rag-rerank'
          : op.operationType.startsWith('graph_') ? 'rag-graphrag'
          : 'rag-vector';

        ledger.ingestUsage(
          { sessionId, personaId, providerId, modelId: op.rerankDetails?.modelId },
          {
            promptTokens: op.tokenUsage.llmPromptTokens,
            completionTokens: op.tokenUsage.llmCompletionTokens,
            totalTokens: op.tokenUsage.totalTokens,
            costUSD: op.costUSD || undefined,
            isFinal: true,
          },
        );
      }
    }

    return trail;
  }
}
