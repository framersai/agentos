/**
 * @module web-search/WebSearchService
 *
 * Multi-provider web search orchestrator.
 * Pipeline: parallel search → semantic dedup → RRF fusion → optional neural reranking.
 */
import type { IWebSearchProvider, WebSearchConfig, EnrichedSearchResult } from './types';
export declare class WebSearchService {
    private providers;
    private readonly config;
    constructor(config?: WebSearchConfig);
    /** Register a search provider. */
    registerProvider(provider: IWebSearchProvider): void;
    /** Check if any providers are registered and available. */
    hasProviders(): boolean;
    /** List registered provider IDs. */
    listProviders(): string[];
    /**
     * Full search pipeline: parallel query → dedup → RRF → optional rerank.
     *
     * @param query - Search query string
     * @param options - Override maxResults or disable reranking
     */
    search(query: string, options?: {
        maxResults?: number;
        rerank?: boolean;
    }): Promise<EnrichedSearchResult[]>;
    /** Convenience: return a function matching the legacy SearchFn signature. */
    asSearchFn(): (query: string) => Promise<EnrichedSearchResult[]>;
}
//# sourceMappingURL=WebSearchService.d.ts.map