/**
 * Infinite Context Window — Module exports.
 */

// Types
export type {
  CompactionEntry,
  CompactionInput,
  CompactionResult,
  CompactionStrategy,
  ContextMessage,
  ICompactionStrategy,
  InfiniteContextConfig,
  SummaryChainNode,
  TransparencyLevel,
} from './types.js';
export { DEFAULT_INFINITE_CONTEXT_CONFIG } from './types.js';

// Core
export { ContextWindowManager } from './ContextWindowManager.js';
export type {
  ContextWindowManagerConfig,
  ContextWindowStats,
} from './ContextWindowManager.js';
export { CompactionEngine } from './CompactionEngine.js';
export { CompactionLog } from './CompactionLog.js';
export type { CompactionLogStats } from './CompactionLog.js';
export { RollingSummaryChain } from './RollingSummaryChain.js';

// Strategies
export { SlidingSummaryStrategy } from './strategies/SlidingSummaryStrategy.js';
export { HierarchicalStrategy } from './strategies/HierarchicalStrategy.js';
export { HybridStrategy } from './strategies/HybridStrategy.js';
