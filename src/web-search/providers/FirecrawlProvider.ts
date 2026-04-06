/**
 * @module web-search/providers/FirecrawlProvider
 *
 * Firecrawl search provider — search + scrape in one API call.
 * Returns full extracted markdown content alongside search results.
 * Primary provider with 1.5x RRF weight.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';

export class FirecrawlProvider implements IWebSearchProvider {
  readonly providerId = 'firecrawl' as const;
  readonly weight = 1.5;

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, limit: number = 5): Promise<WebSearchResult[]> {
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Firecrawl search failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (!data.success || !Array.isArray(data.data)) return [];

    return data.data.map((r: Record<string, unknown>) => ({
      url: String(r.url ?? (r.metadata as Record<string, unknown>)?.sourceURL ?? ''),
      title: String(r.title ?? (r.metadata as Record<string, unknown>)?.title ?? ''),
      snippet: String(r.description ?? (r.metadata as Record<string, unknown>)?.description ?? ''),
      content: typeof r.markdown === 'string' ? r.markdown : undefined,
    }));
  }
}
