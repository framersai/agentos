/**
 * UsageLedger accumulates usage metrics from provider responses.
 * Usage ingestion MUST be called for final streaming chunks or any non-streaming responses.
 */
export class UsageLedger {
    constructor(options = {}) {
        this.buckets = new Map();
        this.options = options;
    }
    /** Compose a stable bucket key from dimensions. */
    bucketKey(dim) {
        return [dim.sessionId, dim.personaId || '-', dim.providerId || '-', dim.modelId || '-'].join('|');
    }
    /** Ensure bucket exists. */
    getOrCreateBucket(dim) {
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
    ingestCompletionChunk(dim, chunk) {
        if (!chunk.usage)
            return; // Nothing to record
        if (!chunk.isFinal && !this.options.includeInterimStreamingUsage)
            return;
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
                    cost += (usage.totalTokens / 1000000) * p.totalPer1M;
                }
                else {
                    if (p.inputPer1M && usage.promptTokens)
                        cost += (usage.promptTokens / 1000000) * p.inputPer1M;
                    if (p.outputPer1M && usage.completionTokens)
                        cost += (usage.completionTokens / 1000000) * p.outputPer1M;
                }
            }
        }
        b.costUSD += cost;
        if (chunk.isFinal)
            b.calls += 1;
    }
    /** Manual ingestion for custom usage objects (e.g. embeddings). */
    ingestUsage(dim, usage) {
        const b = this.getOrCreateBucket({ ...dim, modelId: usage.modelId });
        b.promptTokens += usage.promptTokens || 0;
        b.completionTokens += usage.completionTokens || 0;
        b.totalTokens += usage.totalTokens || 0;
        let cost = usage.costUSD || 0;
        if (!usage.costUSD && this.options.pricingFallbacks) {
            const p = this.options.pricingFallbacks[b.modelId || ''];
            if (p) {
                if (p.totalPer1M) {
                    cost += (usage.totalTokens / 1000000) * p.totalPer1M;
                }
                else {
                    if (p.inputPer1M && usage.promptTokens)
                        cost += (usage.promptTokens / 1000000) * p.inputPer1M;
                    if (p.outputPer1M && usage.completionTokens)
                        cost += (usage.completionTokens / 1000000) * p.outputPer1M;
                }
            }
        }
        b.costUSD += cost;
        if (usage.isFinal)
            b.calls += 1;
    }
    /** Return all summaries. */
    listAllSummaries() {
        return Array.from(this.buckets.values()).map(b => ({ ...b }));
    }
    /** Query by session id. */
    getSummariesBySession(sessionId) {
        return this.listAllSummaries().filter(b => b.sessionId === sessionId);
    }
    /** Aggregate totals across all buckets for a session. */
    getSessionAggregate(sessionId) {
        const buckets = this.getSummariesBySession(sessionId);
        if (!buckets.length)
            return undefined;
        return buckets.reduce((acc, b, i) => {
            if (i === 0)
                acc = { ...b };
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
    async flush() {
        if (!this.options.persistenceAdapter)
            return;
        for (const b of this.buckets.values()) {
            await this.options.persistenceAdapter.save(b);
        }
    }
    /** Load all buckets from persistence (merging into existing). */
    async bootstrapFromPersistence() {
        if (!this.options.persistenceAdapter)
            return;
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
//# sourceMappingURL=UsageLedger.js.map