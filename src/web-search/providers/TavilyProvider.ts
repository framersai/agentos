/**
 * @module web-search/providers/TavilyProvider
 *
 * Tavily AI-optimized search provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';

export class TavilyProvider implements IWebSearchProvider {
  readonly providerId = 'tavily' as const;
  readonly weight = 1.0;

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, limit: number = 5): Promise<WebSearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'advanced',
        include_answer: false,
        include_raw_content: false,
        max_results: limit,
      }),
    });

    const data = await res.json();
    return (data.results ?? []).map((r: Record<string, unknown>) => ({
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      snippet: String(r.content ?? ''),
      relevanceScore: typeof r.score === 'number' ? r.score : 0.5,
    }));
  }
}
