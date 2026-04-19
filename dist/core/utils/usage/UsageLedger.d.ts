/**
 * @fileoverview Aggregates model usage (tokens, cost) across sessions, personas, and providers.
 * Serves as a foundational accounting component for later billing, analytics, and dynamic routing decisions.
 *
 * Design Goals:
 * 1. Low Overhead: Pure in-memory by default; pluggable persistence adapter for durability.
 * 2. Incremental Updates: Accept partial usage metrics from streaming chunks; finalize on terminal chunk.
 * 3. Query Flexibility: Summaries per session, persona, provider, model.
 * 4. Cost Normalization: Uses `ModelUsage.costUSD` when present; can apply fallback pricing from a model catalog.
 */
import { ModelCompletionResponse, ModelUsage } from '../../llm/providers/IProvider';
/** Canonical key dimensions tracked for each usage record. */
export interface UsageDimensions {
    sessionId: string;
    personaId?: string;
    providerId?: string;
    modelId?: string;
}
/** Internal mutable aggregation bucket. */
interface UsageBucket extends UsageDimensions {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUSD: number;
    calls: number;
    /**
     * Tokens served from the provider's prompt-prefix cache (Anthropic
     * cache_read_input_tokens). Only set when the provider reports it;
     * undefined otherwise so consumers can distinguish "not reported"
     * from "zero hits".
     */
    cacheReadTokens?: number;
    /**
     * Tokens written to the provider's prompt-prefix cache as a new
     * entry (Anthropic cache_creation_input_tokens). Same not-reported
     * vs zero convention as cacheReadTokens.
     */
    cacheCreationTokens?: number;
}
/** Result returned by summary queries. */
export type UsageSummary = UsageBucket;
/** Persistence adapter contract enabling storage engines. */
export interface IUsageLedgerPersistence {
    save(bucket: UsageBucket): Promise<void>;
    loadAll(): Promise<UsageBucket[]>;
}
/** Options for UsageLedger behavior. */
export interface UsageLedgerOptions {
    /** When true, interim streaming usage (non-final chunks) will contribute estimated tokens. */
    includeInterimStreamingUsage?: boolean;
    /** Optional pricing fallback map: modelId -> { inputPer1M, outputPer1M }. */
    pricingFallbacks?: Record<string, {
        inputPer1M?: number;
        outputPer1M?: number;
        totalPer1M?: number;
    }>;
    /** Persistence adapter for durability (undefined => in-memory only). */
    persistenceAdapter?: IUsageLedgerPersistence;
}
/**
 * UsageLedger accumulates usage metrics from provider responses.
 * Usage ingestion MUST be called for final streaming chunks or any non-streaming responses.
 */
export declare class UsageLedger {
    private buckets;
    private options;
    constructor(options?: UsageLedgerOptions);
    /** Compose a stable bucket key from dimensions. */
    private bucketKey;
    /** Ensure bucket exists. */
    private getOrCreateBucket;
    /**
     * Ingest a completion response chunk (streaming final or single shot) updating usage aggregates.
     * Non-final streaming chunks are ignored unless includeInterimStreamingUsage=true.
     */
    ingestCompletionChunk(dim: UsageDimensions, chunk: ModelCompletionResponse): void;
    /** Manual ingestion for custom usage objects (e.g. embeddings). */
    ingestUsage(dim: UsageDimensions, usage: ModelUsage & {
        modelId?: string;
        isFinal?: boolean;
    }): void;
    /** Return all summaries. */
    listAllSummaries(): UsageSummary[];
    /** Query by session id. */
    getSummariesBySession(sessionId: string): UsageSummary[];
    /** Aggregate totals across all buckets for a session. */
    getSessionAggregate(sessionId: string): UsageSummary | undefined;
    /** Persist current buckets if an adapter is configured. */
    flush(): Promise<void>;
    /** Load all buckets from persistence (merging into existing). */
    bootstrapFromPersistence(): Promise<void>;
}
export default UsageLedger;
//# sourceMappingURL=UsageLedger.d.ts.map