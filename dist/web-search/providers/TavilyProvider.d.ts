/**
 * @module web-search/providers/TavilyProvider
 *
 * Tavily AI-optimized search provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';
export declare class TavilyProvider implements IWebSearchProvider {
    readonly providerId: "tavily";
    readonly weight = 1;
    private readonly keyPool;
    constructor(apiKey: string);
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<WebSearchResult[]>;
}
//# sourceMappingURL=TavilyProvider.d.ts.map