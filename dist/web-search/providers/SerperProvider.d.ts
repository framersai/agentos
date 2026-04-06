/**
 * @module web-search/providers/SerperProvider
 *
 * Serper (Google Search) provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';
export declare class SerperProvider implements IWebSearchProvider {
    private readonly apiKey;
    readonly providerId: "serper";
    readonly weight = 1;
    constructor(apiKey: string);
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<WebSearchResult[]>;
}
//# sourceMappingURL=SerperProvider.d.ts.map