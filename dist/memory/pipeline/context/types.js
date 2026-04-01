/**
 * Infinite Context Window — Types
 *
 * Data model for context window lifecycle management, compaction strategies,
 * and transparency logging.
 */
export const DEFAULT_INFINITE_CONTEXT_CONFIG = {
    enabled: false,
    strategy: 'sliding',
    compactionThreshold: 0.75,
    preserveRecentTurns: 20,
    transparencyLevel: 'summary',
    logRetention: 100,
    maxSummaryChainTokens: 2000,
    targetCompressionRatio: 8,
};
//# sourceMappingURL=types.js.map