/**
 * @fileoverview Handles external tool result processing for the AgentOS orchestrator.
 *
 * This class encapsulates all logic related to receiving external tool results,
 * feeding them back into the GMI for continued processing, persisting pending
 * external tool requests, and managing the resume-from-persisted-state flow.
 *
 * Extracted from AgentOSOrchestrator to reduce its surface area and improve
 * testability of the external tool continuation path.
 *
 * @module backend/agentos/api/ExternalToolResultHandler
 */
import type { StreamId } from '../../core/streaming/StreamingManager';
import type { StreamChunkEmitter } from './StreamChunkEmitter';
import type { AgentOSOrchestratorDependencies } from '../types/OrchestratorConfig';
import type { AgentOSToolResultInput } from '../types/AgentOSToolResult';
import type { AgentOSPendingExternalToolRequest, AgentOSResumeExternalToolRequestOptions } from '../types/AgentOSExternalToolRequest';
import type { ConversationContext } from '../../core/conversation/ConversationContext';
import type { IGMI, GMIOutput, ToolCallRequest } from '../../cognitive_substrate/IGMI';
/**
 * Internal state for managing an active stream of GMI interaction.
 * Mirrors the definition inside AgentOSOrchestrator so that the handler
 * can operate on the same map reference.
 */
export interface ActiveStreamContext {
    gmi: IGMI;
    userId: string;
    sessionId: string;
    personaId: string;
    conversationId: string;
    organizationId?: string;
    conversationContext: ConversationContext;
    userApiKeys?: Record<string, string>;
    processingOptions?: {
        preferredModelId?: string;
        preferredProviderId?: string;
    };
    languageNegotiation?: any;
}
/**
 * Callback signature for processing GMI output after tool results.
 * The orchestrator or GMIChunkTransformer implements this and supplies
 * it during construction so this handler stays decoupled from those classes.
 */
export type ProcessGMIOutputCallback = (streamId: string, streamContext: ActiveStreamContext, gmiOutput: GMIOutput, isContinuation: boolean) => Promise<void>;
/**
 * @class ExternalToolResultHandler
 * @description
 * Manages the full lifecycle of external tool result handling:
 *
 * 1. **orchestrateToolResult / orchestrateToolResults** - Receives one or more
 *    tool results, persists them to conversation history, feeds them into the
 *    GMI via `handleToolResult` / `handleToolResults`, and processes the
 *    resulting GMI output for further tool calls or final responses.
 *
 * 2. **_resumeToolResultsInternal** - Re-hydrates a stream context from a
 *    persisted `AgentOSPendingExternalToolRequest` after process restart and
 *    delegates to `orchestrateToolResults` for the actual processing.
 *
 * 3. **buildPendingExternalToolRequest / persistPendingExternalToolRequest /
 *    clearPendingExternalToolRequest** - Construct, persist, and clear the
 *    conversation-metadata snapshot that enables cross-restart recovery.
 *
 * All chunk emission is delegated to the shared {@link StreamChunkEmitter}.
 */
export declare class ExternalToolResultHandler {
    private readonly activeStreamContexts;
    private readonly chunks;
    private readonly dependencies;
    private readonly enableConversationalPersistence;
    private processGMIOutputCallback;
    private readonly resolveOrganizationContext;
    /**
     * Creates an ExternalToolResultHandler.
     *
     * @param activeStreamContexts - Shared mutable map of active stream contexts
     *   (same reference held by the orchestrator). This handler reads and writes
     *   entries to coordinate stream lifecycle with the orchestrator.
     * @param chunks - Delegate for assembling and emitting response chunks.
     * @param dependencies - Injected service dependencies (gmiManager,
     *   conversationManager, streamingManager, etc.).
     * @param enableConversationalPersistence - Whether to persist messages to
     *   the ConversationContext store.
     * @param processGMIOutput - Callback invoked to transform a GMIOutput into
     *   response chunks after tool result processing.
     * @param resolveOrganizationContext - Callback to resolve tenant org context.
     */
    constructor(activeStreamContexts: Map<string, ActiveStreamContext>, chunks: StreamChunkEmitter, dependencies: AgentOSOrchestratorDependencies, enableConversationalPersistence: boolean, processGMIOutputCallback: ProcessGMIOutputCallback, resolveOrganizationContext: (inputOrganizationId: unknown) => string | undefined);
    /**
     * Replaces the processGMIOutput callback after construction.
     * Used when the GMIChunkTransformer is created after this handler and the
     * orchestrator needs to re-wire the callback.
     *
     * @param cb - The new callback.
     */
    setProcessGMIOutputCallback(cb: ProcessGMIOutputCallback): void;
    /**
     * Handles the result of a single external tool execution by delegating to
     * {@link orchestrateToolResults}.
     *
     * @param agentOSStreamId - The orchestrator stream ID.
     * @param toolCallId - ID of the tool call being responded to.
     * @param toolName - Name of the tool.
     * @param toolOutput - The output produced by the tool.
     * @param isSuccess - Whether the tool execution succeeded.
     * @param errorMessage - Optional error message if the tool failed.
     */
    orchestrateToolResult(agentOSStreamId: StreamId, toolCallId: string, toolName: string, toolOutput: any, isSuccess: boolean, errorMessage?: string): Promise<void>;
    /**
     * Handles one or more external tool results, feeds them into the GMI, and
     * processes the resulting output. Manages persistence, error recovery, and
     * further tool-call chaining.
     *
     * @param agentOSStreamId - The orchestrator stream ID.
     * @param toolResults - Array of tool results to process.
     * @throws {GMIError} If the stream context is missing or processing fails.
     */
    orchestrateToolResults(agentOSStreamId: StreamId, toolResults: AgentOSToolResultInput[]): Promise<void>;
    /**
     * Resumes an external tool request from persisted conversation metadata.
     * Re-creates the stream context and delegates to {@link orchestrateToolResults}.
     *
     * @param agentOSStreamId - Fresh stream ID allocated by the orchestrator.
     * @param pendingRequest - The persisted pending request snapshot.
     * @param toolResults - Tool results to feed back.
     * @param options - Runtime-only options for resumption (API keys, model prefs).
     */
    resumeToolResultsInternal(agentOSStreamId: StreamId, pendingRequest: AgentOSPendingExternalToolRequest, toolResults: AgentOSToolResultInput[], options: AgentOSResumeExternalToolRequestOptions): Promise<void>;
    /**
     * Constructs a pending external tool request snapshot without persisting it.
     *
     * @param agentOSStreamId - Current stream ID.
     * @param streamContext - Active stream context.
     * @param gmiInstanceId - GMI instance identifier.
     * @param toolCalls - Tool calls that require external execution.
     * @param rationale - Optional rationale text from the agent.
     * @returns The constructed pending request object.
     */
    buildPendingExternalToolRequest(agentOSStreamId: string, streamContext: ActiveStreamContext, gmiInstanceId: string, toolCalls: ToolCallRequest[], rationale?: string): AgentOSPendingExternalToolRequest;
    /**
     * Persists a pending external tool request into conversation metadata so it
     * can survive process restarts.
     *
     * @param agentOSStreamId - Current stream ID.
     * @param streamContext - Active stream context.
     * @param gmiInstanceId - GMI instance identifier.
     * @param toolCalls - Tool calls that require external execution.
     * @param rationale - Optional rationale text from the agent.
     * @returns The persisted pending request object.
     */
    persistPendingExternalToolRequest(agentOSStreamId: string, streamContext: ActiveStreamContext, gmiInstanceId: string, toolCalls: ToolCallRequest[], rationale?: string): Promise<AgentOSPendingExternalToolRequest>;
    /**
     * Clears a previously persisted pending external tool request from
     * conversation metadata.
     *
     * @param conversationContext - The conversation context to clear, or
     *   `undefined` if no context is available (no-op).
     */
    clearPendingExternalToolRequest(conversationContext: ConversationContext | undefined): Promise<void>;
}
//# sourceMappingURL=ExternalToolResultHandler.d.ts.map