/**
 * @module web-search/providers/TavilyProvider
 *
 * Tavily AI-optimized search provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';
export declare class TavilyProvider implements IWebSearchProvider {
    private readonly apiKey;
    readonly providerId: "tavily";
    readonly weight = 1;
    constructor(apiKey: string);
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<WebSearchResult[]>;
}
//# sourceMappingURL=TavilyProvider.d.ts.map