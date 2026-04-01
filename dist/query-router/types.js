/**
 * @fileoverview Core types for the QueryRouter module.
 * @module @framers/agentos/query-router/types
 *
 * Defines all interfaces, configuration, event types, and data structures
 * used by the intelligent query routing pipeline. The QueryRouter classifies
 * incoming queries by complexity tier, retrieves relevant context from vector
 * stores and knowledge graphs, and generates grounded answers with citations.
 *
 * Key concepts:
 * - QueryTier: Four-tier complexity classification (0 = trivial, 3 = research)
 * - ClassificationResult: Output of the query classifier with confidence scoring
 * - RetrievalResult: Aggregated chunks from vector, graph, and research sources
 * - QueryResult: Final answer with citations, timing, and tier metadata
 * - QueryRouterConfig: Public constructor config with sensible defaults
 * - Event system: Discriminated union of lifecycle events for observability
 */
/**
 * Maps a {@link RetrievalStrategy} to the corresponding {@link QueryTier}
 * used by the dispatcher pipeline.
 *
 * This mapping is the canonical bridge between the LLM-as-judge strategy
 * decision and the existing tier-based dispatch infrastructure.
 */
export const STRATEGY_TO_TIER = {
    none: 0,
    simple: 1,
    moderate: 2,
    complex: 3,
};
/**
 * Maps a {@link QueryTier} back to the closest {@link RetrievalStrategy}.
 *
 * Used when the classifier operates in tier-only mode (legacy) and the
 * dispatcher needs to infer the intended strategy.
 */
export const TIER_TO_STRATEGY = {
    0: 'none',
    1: 'simple',
    2: 'moderate',
    3: 'complex',
};
/**
 * Default values for {@link QueryRouterStrategyConfig}.
 */
export const DEFAULT_STRATEGY_CONFIG = {
    defaultStrategy: 'simple',
    forceStrategy: undefined,
    classifierMode: 'hybrid',
    classifierModel: undefined,
    maxSubQueries: 5,
};
/**
 * Default configuration values for the QueryRouter.
 * @see QueryRouterConfig
 */
/**
 * Resolve the default provider dynamically from environment.
 *
 * Priority: autoDetectProvider() → 'openai' fallback.
 * Supports all 16 AgentOS providers including CLI (claude-code-cli, gemini-cli).
 */
function resolveDefaultProvider() {
    try {
        // Lazy check env vars in priority order (same as autoDetectProvider but synchronous)
        const envMap = [
            ['OPENROUTER_API_KEY', 'openrouter'],
            ['OPENAI_API_KEY', 'openai'],
            ['ANTHROPIC_API_KEY', 'anthropic'],
            ['GEMINI_API_KEY', 'gemini'],
            ['GROQ_API_KEY', 'groq'],
            ['TOGETHER_API_KEY', 'together'],
            ['MISTRAL_API_KEY', 'mistral'],
            ['XAI_API_KEY', 'xai'],
        ];
        for (const [envKey, id] of envMap) {
            if (process.env[envKey])
                return id;
        }
    }
    catch {
        // Browser or restricted env — fall back
    }
    return 'openai';
}
/** Provider → cheap model mapping for classifier/T0-T1 generation. */
const CHEAP_MODELS = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    openrouter: 'openai/gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
    groq: 'gemma2-9b-it',
    together: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    mistral: 'mistral-small-latest',
    xai: 'grok-2-mini',
    ollama: 'llama3.2',
    'claude-code-cli': 'claude-haiku-4-5-20251001',
    'gemini-cli': 'gemini-2.0-flash-lite',
};
/** Provider → strong model mapping for T2/T3 deep generation. */
const STRONG_MODELS = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    openrouter: 'openai/gpt-4o',
    gemini: 'gemini-2.5-flash',
    groq: 'llama-3.3-70b-versatile',
    together: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    mistral: 'mistral-large-latest',
    xai: 'grok-2',
    ollama: 'llama3.2',
    'claude-code-cli': 'claude-sonnet-4-20250514',
    'gemini-cli': 'gemini-2.5-flash',
};
export const DEFAULT_QUERY_ROUTER_CONFIG = {
    confidenceThreshold: 0.7,
    classifierModel: CHEAP_MODELS[resolveDefaultProvider()] ?? 'gpt-4o-mini',
    classifierProvider: resolveDefaultProvider(),
    maxTier: 3,
    embeddingProvider: resolveDefaultProvider(),
    embeddingModel: 'text-embedding-3-small',
    generationModel: CHEAP_MODELS[resolveDefaultProvider()] ?? 'gpt-4o-mini',
    generationModelDeep: STRONG_MODELS[resolveDefaultProvider()] ?? 'gpt-4o',
    generationProvider: resolveDefaultProvider(),
    graphEnabled: true,
    deepResearchEnabled: Boolean(process.env.SERPER_API_KEY),
    conversationWindowSize: 5,
    maxContextTokens: 4000,
    cacheResults: true,
    availableTools: [],
    includePlatformKnowledge: true,
    verifyCitations: false,
};
//# sourceMappingURL=types.js.map