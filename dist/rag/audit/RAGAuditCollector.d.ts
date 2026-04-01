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
import type { RAGAuditTrail, RAGOperationEntry } from './RAGAuditTypes.js';
/** Minimal UsageLedger interface to avoid hard dependency on core/utils/usage. */
interface UsageLedgerLike {
    ingestUsage(dim: {
        sessionId: string;
        personaId?: string;
        providerId?: string;
        modelId?: string;
    }, usage: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        costUSD?: number;
        isFinal?: boolean;
    }): void;
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
export declare class RAGOperationHandle {
    private readonly entry;
    private readonly startTime;
    private completed;
    private readonly onComplete;
    constructor(type: RAGOperationEntry['operationType'], onComplete: (entry: RAGOperationEntry) => void);
    setRetrievalMethod(method: RAGOperationEntry['retrievalMethod']): this;
    addSources(chunks: Array<{
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
    }>): this;
    setTokenUsage(usage: RAGOperationEntry['tokenUsage']): this;
    setCost(costUSD: number): this;
    setDataSourceIds(ids: string[]): this;
    setCollectionIds(ids: string[]): this;
    setGraphDetails(details: NonNullable<RAGOperationEntry['graphDetails']>): this;
    setRerankDetails(details: NonNullable<RAGOperationEntry['rerankDetails']>): this;
    /**
     * Attach HyDE-specific metadata to this audit operation.
     *
     * @param details - Hypothesis text, effective threshold, and step count.
     * @returns `this` for fluent chaining.
     */
    setHydeDetails(details: NonNullable<RAGOperationEntry['hydeDetails']>): this;
    /**
     * Finalizes the operation, records duration, computes relevance score stats,
     * and adds the entry to the parent collector.
     *
     * @param resultsCount Number of results this operation produced.
     * @param overrideDurationMs Optional override for duration (when timing is measured externally).
     */
    complete(resultsCount: number, overrideDurationMs?: number): RAGOperationEntry;
}
/**
 * Request-scoped audit collector. Create one per `retrieveContext()` call.
 * NOT a singleton — scoped to a single pipeline execution.
 */
export declare class RAGAuditCollector {
    private readonly options;
    private readonly trailId;
    private readonly startTime;
    private readonly operations;
    constructor(options: RAGAuditCollectorOptions);
    /** Start tracking a new operation. Returns a fluent handle. */
    startOperation(type: RAGOperationEntry['operationType']): RAGOperationHandle;
    /** Finalize and return the complete audit trail with computed summary. */
    finalize(): RAGAuditTrail;
}
export {};
//# sourceMappingURL=RAGAuditCollector.d.ts.map