import type { ToolExecutionContext } from '../../../core/tools/ITool.js';
/**
 * Resolve the effective scope identity for a memory tool call from the active
 * execution context.
 *
 * `user` and `persona` scopes are always resolvable in normal AgentOS tool
 * execution because `userContext.userId` and `personaId` are required.
 * `thread` and `organization` additionally rely on optional `sessionData`.
 */
export declare function resolveMemoryToolScopeId(scope: string | undefined, context: ToolExecutionContext): string | undefined;
//# sourceMappingURL=scopeContext.d.ts.map