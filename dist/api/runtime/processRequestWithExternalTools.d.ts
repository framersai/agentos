import type { AgentOSInput } from '../types/AgentOSInput';
import { type AgentOSActionableToolCallRequestChunk, type AgentOSResponse } from '../types/AgentOSResponse';
import type { IAgentOS } from '../interfaces/IAgentOS';
import type { ToolCallRequest } from '../../cognitive_substrate/IGMI';
export interface AgentOSExternalToolHandlerContext {
    agentos: Pick<IAgentOS, 'handleToolResult'> & Partial<Pick<IAgentOS, 'handleToolResults'>>;
    streamId: string;
    requestChunk: AgentOSActionableToolCallRequestChunk;
    toolCall: ToolCallRequest;
}
export interface AgentOSExternalToolHandlerResult {
    toolOutput: unknown;
    isSuccess?: boolean;
    errorMessage?: string;
}
export type AgentOSExternalToolHandler = (context: AgentOSExternalToolHandlerContext) => Promise<AgentOSExternalToolHandlerResult>;
/**
 * Runs a full `AgentOS.processRequest(...)` turn and automatically resumes any
 * actionable external tool pauses through `handleToolResult(...)`.
 *
 * Actionable external tool calls are executed in emitted order. When a pause
 * contains multiple actionable tool calls, the helper batches their results and
 * resumes the stream once through `handleToolResults(...)` when available.
 */
export declare function processRequestWithExternalTools(agentos: Pick<IAgentOS, 'processRequest' | 'handleToolResult'> & Partial<Pick<IAgentOS, 'handleToolResults'>>, input: AgentOSInput, executeToolCall: AgentOSExternalToolHandler): AsyncGenerator<AgentOSResponse, void, undefined>;
//# sourceMappingURL=processRequestWithExternalTools.d.ts.map