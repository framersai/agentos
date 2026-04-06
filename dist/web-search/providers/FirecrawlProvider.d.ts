/**
 * @module web-search/providers/FirecrawlProvider
 *
 * Firecrawl search provider — search + scrape in one API call.
 * Returns full extracted markdown content alongside search results.
 * Primary provider with 1.5x RRF weight.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';
export declare class FirecrawlProvider implements IWebSearchProvider {
    private readonly apiKey;
    readonly providerId: "firecrawl";
    readonly weight = 1.5;
    constructor(apiKey: string);
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<WebSearchResult[]>;
}
//# sourceMappingURL=FirecrawlProvider.d.ts.map