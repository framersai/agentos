/**
 * @module @framers/agentos/web-search
 *
 * Multi-provider web search with RRF fusion, semantic dedup, and neural reranking.
 * Supports Firecrawl (primary), Tavily, Serper, and Brave search providers.
 *
 * @example
 * ```typescript
 * import { WebSearchService, FirecrawlProvider, TavilyProvider } from '../web-search/index.js';
 *
 * const service = new WebSearchService();
 * service.registerProvider(new FirecrawlProvider(process.env.FIRECRAWL_API_KEY!));
 * service.registerProvider(new TavilyProvider(process.env.TAVILY_API_KEY!));
 *
 * const results = await service.search('quantum computing breakthroughs 2026');
 * // Results are deduped, RRF-scored, and optionally reranked
 * ```
 */
// Service
export { WebSearchService } from './WebSearchService.js';
// Providers
export { FirecrawlProvider } from './providers/FirecrawlProvider.js';
export { TavilyProvider } from './providers/TavilyProvider.js';
export { SerperProvider } from './providers/SerperProvider.js';
export { BraveProvider } from './providers/BraveProvider.js';
// Fusion utilities
export { normalizeUrl, computeRRF, computeWeightedRRF } from './fusion.js';
// Dedup utilities
export { semanticDedup, buildVocabulary, buildTfVector } from './dedup.js';
//# sourceMappingURL=index.js.map