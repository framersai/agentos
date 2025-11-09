// File: packages/agentos/src/core/usage/UsageLedger.ts
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
import { ModelCompletionResponse, ModelUsage } from '../llm/providers/IProvider';

/** Canonical key dimensions tracked for each usage record. */
export interface UsageDimensions {
  sessionId: string;          // Conversation or workflow session identifier
  personaId?: string;         // Optional persona applied
  providerId?: string;        // Provider emitting usage (openai, ollama, etc.)
  modelId?: string;           // Model identifier (gpt-4, llama3:8b, etc.)
}

/** Internal mutable aggregation bucket. */
interface UsageBucket extends UsageDimensions {
  promptTokens: number;       // Sum of prompt tokens (final chunk value; interim partials ignored unless configured)
  completionTokens: number;   // Sum of completion tokens
  totalTokens: number;        // Sum of total tokens (may differ from prompt+completion if provider supplies extras)
  costUSD: number;            // Accumulated cost in USD
  calls: number;              // Number of completed calls contributing usage
}

/** Result returned by summary queries. */
export interface UsageSummary extends UsageBucket {}

/** Persistence adapter contract enabling storage engines. */
export interface IUsageLedgerPersistence {
  save(bucket: UsageBucket): Promise<void>;
  loadAll(): Promise<UsageBucket[]>; // For bootstrapping (may be large; future pagination TBD)
}

/** Options for UsageLedger behavior. */
export interface UsageLedgerOptions {
  /** When true, interim streaming usage (non-final chunks) will contribute estimated tokens. */
  includeInterimStreamingUsage?: boolean;
  /** Optional pricing fallback map: modelId -> { inputPer1M, outputPer1M }. */
  pricingFallbacks?: Record<string, { inputPer1M?: number; outputPer1M?: number; totalPer1M?: number }>;
  /** Persistence adapter for durability (undefined => in-memory only). */
  persistenceAdapter?: IUsageLedgerPersistence;
}

/**
 * UsageLedger accumulates usage metrics from provider responses.
 * Usage ingestion MUST be called for final streaming chunks or any non-streaming responses.
 */
export class UsageLedger {
  private buckets: Map<string, UsageBucket> = new Map();
  private options: UsageLedgerOptions;

  constructor(options: UsageLedgerOptions = {}) {
    this.options = options;
  }

  /** Compose a stable bucket key from dimensions. */
  private bucketKey(dim: UsageDimensions): string {
    return [dim.sessionId, dim.personaId || '-', dim.providerId || '-', dim.modelId || '-'].join('|');
  }

  /** Ensure bucket exists. */
  private getOrCreateBucket(dim: UsageDimensions): UsageBucket {
    const key = this.bucketKey(dim);
    let b = this.buckets.get(key);
    if (!b) {
      b = { ...dim, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUSD: 0, calls: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Ingest a completion response chunk (streaming final or single shot) updating usage aggregates.
   * Non-final streaming chunks are ignored unless includeInterimStreamingUsage=true.
   */
  ingestCompletionChunk(dim: UsageDimensions, chunk: ModelCompletionResponse): void {
    if (!chunk.usage) return; // Nothing to record
    if (!chunk.isFinal && !this.options.includeInterimStreamingUsage) return;

    const usage = chunk.usage;
    const b = this.getOrCreateBucket({ ...dim, modelId: chunk.modelId });

    // Interim usage may be partial; we accumulate naive sums.
    b.promptTokens += usage.promptTokens || 0;
    b.completionTokens += usage.completionTokens || 0;
    b.totalTokens += usage.totalTokens || 0;

    // Cost: prefer provided costUSD else derive from fallback pricing.
    let cost = usage.costUSD || 0;
    if (!usage.costUSD && this.options.pricingFallbacks) {
      const p = this.options.pricingFallbacks[b.modelId || ''];
      if (p) {
        // If provider splits prompt/completion tokens we can estimate using input/output rates.
        if (p.totalPer1M) {
          cost += (usage.totalTokens / 1_000_000) * p.totalPer1M;
        } else {
          if (p.inputPer1M && usage.promptTokens) cost += (usage.promptTokens / 1_000_000) * p.inputPer1M;
          if (p.outputPer1M && usage.completionTokens) cost += (usage.completionTokens / 1_000_000) * p.outputPer1M;
        }
      }
    }
    b.costUSD += cost;

    if (chunk.isFinal) b.calls += 1;
  }

  /** Manual ingestion for custom usage objects (e.g. embeddings). */
  ingestUsage(dim: UsageDimensions, usage: ModelUsage & { modelId?: string; isFinal?: boolean }): void {
    const b = this.getOrCreateBucket({ ...dim, modelId: usage.modelId });
    b.promptTokens += usage.promptTokens || 0;
    b.completionTokens += usage.completionTokens || 0;
    b.totalTokens += usage.totalTokens || 0;

    let cost = usage.costUSD || 0;
    if (!usage.costUSD && this.options.pricingFallbacks) {
      const p = this.options.pricingFallbacks[b.modelId || ''];
      if (p) {
        if (p.totalPer1M) {
          cost += (usage.totalTokens / 1_000_000) * p.totalPer1M;
        } else {
          if (p.inputPer1M && usage.promptTokens) cost += (usage.promptTokens / 1_000_000) * p.inputPer1M;
          if (p.outputPer1M && usage.completionTokens) cost += (usage.completionTokens / 1_000_000) * p.outputPer1M;
        }
      }
    }
    b.costUSD += cost;
    if (usage.isFinal) b.calls += 1;
  }

  /** Return all summaries. */
  listAllSummaries(): UsageSummary[] {
    return Array.from(this.buckets.values()).map(b => ({ ...b }));
  }

  /** Query by session id. */
  getSummariesBySession(sessionId: string): UsageSummary[] {
    return this.listAllSummaries().filter(b => b.sessionId === sessionId);
  }

  /** Aggregate totals across all buckets for a session. */
  getSessionAggregate(sessionId: string): UsageSummary | undefined {
    const buckets = this.getSummariesBySession(sessionId);
    if (!buckets.length) return undefined;
    return buckets.reduce<UsageSummary>((acc, b, i) => {
      if (i === 0) acc = { ...b };
      else {
        acc.promptTokens += b.promptTokens;
        acc.completionTokens += b.completionTokens;
        acc.totalTokens += b.totalTokens;
        acc.costUSD += b.costUSD;
        acc.calls += b.calls;
      }
      return acc;
    }, buckets[0]);
  }

  /** Persist current buckets if an adapter is configured. */
  async flush(): Promise<void> {
    if (!this.options.persistenceAdapter) return;
    for (const b of this.buckets.values()) {
      await this.options.persistenceAdapter.save(b);
    }
  }

  /** Load all buckets from persistence (merging into existing). */
  async bootstrapFromPersistence(): Promise<void> {
    if (!this.options.persistenceAdapter) return;
    const loaded = await this.options.persistenceAdapter.loadAll();
    for (const b of loaded) {
      const existing = this.getOrCreateBucket(b);
      existing.promptTokens += b.promptTokens;
      existing.completionTokens += b.completionTokens;
      existing.totalTokens += b.totalTokens;
      existing.costUSD += b.costUSD;
      existing.calls += b.calls;
    }
  }
}

export default UsageLedger;
