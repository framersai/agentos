/**
 * @module safety
 * @description Agent safety primitives — circuit breaker, action deduplication,
 * stuck detection, cost guards, and tool execution guards.
 */

export { CircuitBreaker, CircuitOpenError } from './CircuitBreaker.js';
export type { CircuitState, CircuitBreakerConfig, CircuitBreakerStats } from './CircuitBreaker.js';

export { ActionDeduplicator } from './ActionDeduplicator.js';
export type { ActionDeduplicatorConfig, DeduplicatorEntry } from './ActionDeduplicator.js';

export { StuckDetector } from './StuckDetector.js';
export type { StuckDetectorConfig, StuckReason, StuckDetection } from './StuckDetector.js';

export { CostGuard, CostCapExceededError } from './CostGuard.js';
export type { CostGuardConfig, CostCapType, CostRecord, CostSnapshot } from './CostGuard.js';

export { ToolExecutionGuard, ToolTimeoutError } from './ToolExecutionGuard.js';
export type { ToolExecutionGuardConfig, GuardedToolResult, ToolHealthReport } from './ToolExecutionGuard.js';
