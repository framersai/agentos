/**
 * Agent safety primitives: circuit breaker, action deduplication,
 * stuck detection, cost guards, and tool execution guards.
 *
 * @module safety
 */
export { CircuitBreaker, CircuitOpenError } from './CircuitBreaker.js';
export { ActionDeduplicator } from './ActionDeduplicator.js';
export { StuckDetector } from './StuckDetector.js';
export { CostGuard, CostCapExceededError } from './CostGuard.js';
export { ToolExecutionGuard, ToolTimeoutError } from './ToolExecutionGuard.js';
//# sourceMappingURL=index.js.map