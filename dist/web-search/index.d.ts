/**
 * @module @framers/agentos/web-search
 *
 * Multi-provider web search with RRF fusion, semantic dedup, and neural reranking.
 * Supports Firecrawl (primary), Tavily, Serper, and Brave search providers.
 *
 * @example
 * ```typescript
 * import { WebSearchService, FirecrawlProvider, TavilyProvider } from '@framers/agentos/web-search';
 *
 * const service = new WebSearchService();
 * service.registerProvider(new FirecrawlProvider(process.env.FIRECRAWL_API_KEY!));
 * service.registerProvider(new TavilyProvider(process.env.TAVILY_API_KEY!));
 *
 * const results = await service.search('quantum computing breakthroughs 2026');
 * // Results are deduped, RRF-scored, and optionally reranked
 * ```
 */
export type { IWebSearchProvider, WebSearchResult, EnrichedSearchResult, WebSearchConfig, RRFCandidate, } from './types';
export { WebSearchService } from './WebSearchService';
export { FirecrawlProvider } from './providers/FirecrawlProvider';
export { TavilyProvider } from './providers/TavilyProvider';
export { SerperProvider } from './providers/SerperProvider';
export { BraveProvider } from './providers/BraveProvider';
export { normalizeUrl, computeRRF, computeWeightedRRF } from './fusion';
export { semanticDedup, buildVocabulary, buildTfVector } from './dedup';
//# sourceMappingURL=index.d.ts.map