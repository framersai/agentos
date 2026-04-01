/**
 * @fileoverview Content feature detection for memory encoding.
 *
 * Three strategies (configurable per-agent):
 * - `keyword`  — fast regex/lexicon-based heuristics (zero latency, no LLM cost)
 * - `llm`      — cheap LLM call for accurate classification
 * - `hybrid`   — keywords in real-time, LLM retroactively during consolidation
 *
 * @module agentos/memory/encoding/ContentFeatureDetector
 */
import type { ContentFeatures } from '../types.js';
export interface IContentFeatureDetector {
    detect(text: string): Promise<ContentFeatures>;
}
export declare class KeywordFeatureDetector implements IContentFeatureDetector {
    detect(text: string): Promise<ContentFeatures>;
}
export declare class LlmFeatureDetector implements IContentFeatureDetector {
    private llmInvoker;
    constructor(llmInvoker: (system: string, user: string) => Promise<string>);
    detect(text: string): Promise<ContentFeatures>;
}
/**
 * Uses keyword detection for real-time encoding. Exposes `detectWithLlm()`
 * for retroactive re-classification during consolidation.
 */
export declare class HybridFeatureDetector implements IContentFeatureDetector {
    private keyword;
    private llm;
    constructor(llmInvoker?: (system: string, user: string) => Promise<string>);
    /** Real-time detection: keyword only (zero latency). */
    detect(text: string): Promise<ContentFeatures>;
    /** Deferred detection: LLM-based (called during consolidation). */
    detectWithLlm(text: string): Promise<ContentFeatures>;
}
export declare function createFeatureDetector(strategy: 'keyword' | 'llm' | 'hybrid', llmInvoker?: (system: string, user: string) => Promise<string>): IContentFeatureDetector;
//# sourceMappingURL=ContentFeatureDetector.d.ts.map