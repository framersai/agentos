/**
 * @module web-search/providers/SerperProvider
 *
 * Serper (Google Search) provider.
 */
import type { IWebSearchProvider, WebSearchResult } from '../types';

export class SerperProvider implements IWebSearchProvider {
  readonly providerId = 'serper' as const;
  readonly weight = 1.0;

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, limit: number = 5): Promise<WebSearchResult[]> {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: limit }),
    });

    const data = await res.json();
    return (data.organic ?? []).map((r: Record<string, unknown>) => ({
      url: String(r.link ?? ''),
      title: String(r.title ?? ''),
      snippet: String(r.snippet ?? ''),
    }));
  }
}
