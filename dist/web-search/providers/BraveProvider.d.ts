/**
 * @module web-search/providers/BraveProvider
 *
 * Brave Search API provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';
export declare class BraveProvider implements IWebSearchProvider {
    readonly providerId: "brave";
    readonly weight = 1;
    private readonly keyPool;
    constructor(apiKey: string);
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<WebSearchResult[]>;
}
//# sourceMappingURL=BraveProvider.d.ts.map