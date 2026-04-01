import type { UserContext } from '../../cognitive_substrate/IGMI';
import type { ToolExecutionContext } from '../../core/tools/ITool';
import type { IAgentOS } from '../interfaces/IAgentOS';
import type { AgentOSInput } from '../types/AgentOSInput';
import { type ExternalToolRegistry } from './externalToolRegistry';
import { type AgentOSExternalToolHandler, type AgentOSExternalToolHandlerContext } from './processRequestWithExternalTools';
import type { AgentOSResponse } from '../types/AgentOSResponse';
export interface RegisteredExternalToolExecutionOptions {
    /**
     * Optional additional user-context fields to merge into the live tool
     * execution context. `input.userId` always wins.
     */
    userContext?: Partial<UserContext>;
    /**
     * Trusted runtime-only organization context to propagate into both
     * `userContext.organizationId` and `sessionData.organizationId`.
     */
    organizationId?: string;
    /**
     * Optional correlation ID override. Defaults to the tool call ID.
     */
    correlationId?: string;
    /**
     * Optional fallback for actionable external tool calls that are not
     * registered in AgentOS. Use this when the same turn can mix
     * AgentOS-registered tools with custom host-managed tools.
     */
    fallbackExternalToolHandler?: AgentOSExternalToolHandler;
    /**
     * Optional map, array, or iterable of host-managed external tools to use
     * when a tool name is not registered in AgentOS itself.
     */
    externalTools?: ExternalToolRegistry;
}
type RegisteredToolRuntime = Pick<IAgentOS, 'processRequest' | 'handleToolResult' | 'getToolOrchestrator'> & Partial<Pick<IAgentOS, 'getExternalToolRegistry' | 'handleToolResults'>>;
/**
 * Builds the `ToolExecutionContext` for a host-managed external tool call that
 * should execute against AgentOS's registered tool registry during a live
 * `processRequest(...)` stream.
 */
export declare function buildRegisteredExternalToolExecutionContext(input: AgentOSInput, context: Pick<AgentOSExternalToolHandlerContext, 'requestChunk' | 'toolCall'>, options?: RegisteredExternalToolExecutionOptions): ToolExecutionContext;
/**
 * Creates an external-tool handler that executes AgentOS-registered tools with
 * the correct live-turn execution context, then optionally falls back to a
 * host-provided external tool registry or dynamic callback.
 */
export declare function createRegisteredExternalToolHandler(agentos: Pick<IAgentOS, 'getToolOrchestrator'> & Partial<Pick<IAgentOS, 'getExternalToolRegistry'>>, input: AgentOSInput, options?: RegisteredExternalToolExecutionOptions): AgentOSExternalToolHandler;
/**
 * Runs a full `AgentOS.processRequest(...)` turn and executes any actionable
 * external tool pauses against AgentOS's registered tools automatically.
 * Missing tool names can optionally fall back to `externalTools` or
 * `fallbackExternalToolHandler`.
 */
export declare function processRequestWithRegisteredTools(agentos: RegisteredToolRuntime, input: AgentOSInput, options?: RegisteredExternalToolExecutionOptions): AsyncGenerator<AgentOSResponse, void, undefined>;
export {};
//# sourceMappingURL=processRequestWithRegisteredTools.d.ts.map