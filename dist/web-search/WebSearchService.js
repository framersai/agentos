import { normalizeUrl, computeWeightedRRF } from './fusion.js';
import { semanticDedup } from './dedup.js';
export class WebSearchService {
    constructor(config) {
        this.providers = [];
        this.config = {
            dedupThreshold: config?.dedupThreshold ?? 0.85,
            maxResults: config?.maxResults ?? 12,
            ...config,
        };
    }
    /** Register a search provider. */
    registerProvider(provider) {
        this.providers.push(provider);
    }
    /** Check if any providers are registered and available. */
    hasProviders() {
        return this.providers.some((p) => p.isAvailable());
    }
    /** List registered provider IDs. */
    listProviders() {
        return this.providers.map((p) => p.providerId);
    }
    /**
     * Full search pipeline: parallel query → dedup → RRF → optional rerank.
     *
     * @param query - Search query string
     * @param options - Override maxResults or disable reranking
     */
    async search(query, options) {
        const available = this.providers.filter((p) => p.isAvailable());
        if (available.length === 0)
            return [];
        // ── Parallel search across all available providers ──
        const settled = await Promise.allSettled(available.map((p) => p.search(query)));
        // ── Collect as RRF candidates ──
        const allCandidates = [];
        for (let i = 0; i < available.length; i++) {
            const outcome = settled[i];
            if (outcome.status !== 'fulfilled')
                continue;
            const provider = available[i];
            for (let rank = 0; rank < outcome.value.length; rank++) {
                const r = outcome.value[rank];
                allCandidates.push({
                    url: r.url,
                    normalizedUrl: normalizeUrl(r.url),
                    title: r.title,
                    snippet: r.snippet,
                    content: r.content,
                    providerRanks: new Map([[provider.providerId, rank]]),
                    providerSources: [provider.providerId],
                    rrfScore: 0,
                    relevanceScore: r.relevanceScore,
                });
            }
        }
        if (allCandidates.length === 0)
            return [];
        // ── Semantic dedup ──
        const deduped = semanticDedup(allCandidates, this.config.dedupThreshold);
        // ── RRF scoring with provider weights ──
        const weights = {};
        for (const p of available) {
            weights[p.providerId] = p.weight;
        }
        computeWeightedRRF(deduped, weights);
        // ── Slice to max results ──
        const maxResults = options?.maxResults ?? this.config.maxResults;
        const enriched = deduped.slice(0, maxResults).map((c) => ({
            url: c.url,
            title: c.title,
            snippet: c.snippet,
            content: c.content,
            relevanceScore: c.relevanceScore,
            providerSources: c.providerSources,
            rrfScore: c.rrfScore,
        }));
        // ── Neural reranking (optional) ──
        const shouldRerank = options?.rerank !== false;
        if (shouldRerank && this.config.reranker && this.config.rerankChain) {
            try {
                const chunks = enriched.map((r, i) => ({
                    id: `search-${i}`,
                    originalDocumentId: r.url,
                    content: r.content ?? r.snippet,
                    relevanceScore: r.rrfScore,
                    metadata: { url: r.url, title: r.title },
                }));
                const reranked = await this.config.reranker.rerankChain(query, chunks, this.config.rerankChain);
                const resultMap = new Map(enriched.map((r, i) => [`search-${i}`, r]));
                return reranked.map((chunk) => {
                    const original = resultMap.get(chunk.id);
                    return { ...original, rerankScore: chunk.relevanceScore ?? 0 };
                });
            }
            catch {
                // Reranking failure is non-fatal
            }
        }
        return enriched;
    }
    /** Convenience: return a function matching the legacy SearchFn signature. */
    asSearchFn() {
        return (query) => this.search(query);
    }
}
//# sourceMappingURL=WebSearchService.js.map