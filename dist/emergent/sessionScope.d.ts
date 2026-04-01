import type { ToolExecutionContext } from '../core/tools/ITool.js';
/**
 * Resolve a stable session key for self-improvement tools.
 *
 * Prefer explicit session-scoped identifiers when available so multiple tool
 * calls in the same run share state, even if each call has a unique
 * correlation ID.
 */
export declare function resolveSelfImprovementSessionKey(context: ToolExecutionContext): string;
//# sourceMappingURL=sessionScope.d.ts.map