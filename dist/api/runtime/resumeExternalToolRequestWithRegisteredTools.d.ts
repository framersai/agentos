import type { UserContext, ToolCallRequest } from '../../cognitive_substrate/IGMI';
import type { ToolExecutionContext } from '../../core/tools/ITool';
import type { IAgentOS } from '../interfaces/IAgentOS';
import type { AgentOSPendingExternalToolRequest, AgentOSResumeExternalToolRequestOptions } from '../types/AgentOSExternalToolRequest';
import type { AgentOSResponse } from '../types/AgentOSResponse';
import type { AgentOSToolResultInput } from '../types/AgentOSToolResult';
import { type ExternalToolRegistry } from './externalToolRegistry';
import type { AgentOSExternalToolHandlerResult } from './processRequestWithExternalTools';
export interface PendingExternalToolExecutionOptions {
    /**
     * Optional additional user-context fields to merge into the execution
     * context. `pendingRequest.userId` always wins.
     */
    userContext?: Partial<UserContext>;
    /**
     * Trusted runtime-only organization context to propagate into both
     * `userContext.organizationId` and `sessionData.organizationId`.
     */
    organizationId?: string;
    /**
     * Optional correlation ID for tool execution tracing. Defaults to the pending
     * stream ID when omitted.
     */
    correlationId?: string;
    /**
     * Optional fallback for pending external tool calls that are not registered
     * in AgentOS. Use this when the same persisted pause can mix AgentOS-
     * registered tools with custom host-managed tools.
     */
    fallbackExternalToolHandler?: PendingExternalToolHandler;
    /**
     * Optional map, array, or iterable of host-managed external tools to use
     * when a tool name is not registered in AgentOS itself.
     */
    externalTools?: ExternalToolRegistry;
}
export interface ResumeExternalToolRequestWithRegisteredToolsOptions extends PendingExternalToolExecutionOptions, AgentOSResumeExternalToolRequestOptions {
}
type RegisteredToolExecutionRuntime = Pick<IAgentOS, 'getToolOrchestrator' | 'resumeExternalToolRequest'> & Partial<Pick<IAgentOS, 'getExternalToolRegistry'>>;
export interface PendingExternalToolHandlerContext {
    agentos: Pick<IAgentOS, 'getToolOrchestrator'>;
    pendingRequest: AgentOSPendingExternalToolRequest;
    toolCall: ToolCallRequest;
}
export type PendingExternalToolHandler = (context: PendingExternalToolHandlerContext) => Promise<AgentOSExternalToolHandlerResult>;
/**
 * Builds the `ToolExecutionContext` that a host should use when it wants to
 * execute a persisted external tool pause against AgentOS's registered tool
 * registry after restart.
 */
export declare function buildPendingExternalToolExecutionContext(pendingRequest: AgentOSPendingExternalToolRequest, options?: PendingExternalToolExecutionOptions): ToolExecutionContext;
/**
 * Executes one pending external tool call through AgentOS's registered tool
 * registry using the correct resume-time execution context, then optionally
 * falls back to a host-provided external tool registry or dynamic callback.
 */
export declare function executePendingExternalToolCall(agentos: Pick<IAgentOS, 'getToolOrchestrator'> & Partial<Pick<IAgentOS, 'getExternalToolRegistry'>>, pendingRequest: AgentOSPendingExternalToolRequest, toolCall: ToolCallRequest, options?: PendingExternalToolExecutionOptions): Promise<AgentOSToolResultInput>;
/**
 * Executes all tool calls from a persisted external-tool pause, in order,
 * through AgentOS's registered tool registry.
 */
export declare function executePendingExternalToolCalls(agentos: Pick<IAgentOS, 'getToolOrchestrator'> & Partial<Pick<IAgentOS, 'getExternalToolRegistry'>>, pendingRequest: AgentOSPendingExternalToolRequest, options?: PendingExternalToolExecutionOptions): Promise<AgentOSToolResultInput[]>;
/**
 * Executes all pending registered tool calls from a persisted external-tool
 * pause and immediately resumes the AgentOS stream on the caller's behalf.
 * Missing tool names can optionally fall back to `externalTools` or
 * `fallbackExternalToolHandler`.
 */
export declare function resumeExternalToolRequestWithRegisteredTools(agentos: RegisteredToolExecutionRuntime, pendingRequest: AgentOSPendingExternalToolRequest, options?: ResumeExternalToolRequestWithRegisteredToolsOptions): AsyncGenerator<AgentOSResponse, void, undefined>;
export {};
//# sourceMappingURL=resumeExternalToolRequestWithRegisteredTools.d.ts.map