/**
 * @module web-search/providers/BraveProvider
 *
 * Brave Search API provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';

export class BraveProvider implements IWebSearchProvider {
  readonly providerId = 'brave' as const;
  readonly weight = 1.0;

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, limit: number = 5): Promise<WebSearchResult[]> {
    const params = new URLSearchParams({ q: query, count: String(limit) });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'X-Subscription-Token': this.apiKey },
    });

    const data = await res.json();
    return (data.web?.results ?? []).map((r: Record<string, unknown>) => ({
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      snippet: String(r.description ?? ''),
    }));
  }
}
