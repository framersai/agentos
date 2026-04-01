/**
 * @fileoverview Transforms GMI output into AgentOS response chunks.
 *
 * This class encapsulates the mapping layer between GMI's internal output
 * representation (GMIOutput, GMIOutputChunk) and the public-facing AgentOS
 * response chunk types. It also handles GMI input construction from AgentOS
 * input and capability discovery filtering.
 *
 * Extracted from AgentOSOrchestrator to separate the data-transformation
 * concerns from orchestration control flow.
 *
 * @module backend/agentos/api/GMIChunkTransformer
 */
import type { StreamChunkEmitter } from './StreamChunkEmitter';
import type { AgentOSOrchestratorDependencies } from '../types/OrchestratorConfig';
import type { AgentOSInput } from '../types/AgentOSInput';
import type { ConversationContext } from '../../core/conversation/ConversationContext';
import type { IGMI, GMITurnInput, GMIOutputChunk, GMIOutput } from '../../cognitive_substrate/IGMI';
import type { TurnPlan } from '../../orchestration/turn-planner/TurnPlanner';
/**
 * Minimal stream context shape needed by the transformer.
 * Mirrors the ActiveStreamContext defined in AgentOSOrchestrator.
 */
export interface TransformerStreamContext {
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
 * Callback for clearing pending external tool requests.
 * Provided by the ExternalToolResultHandler so the transformer does not need
 * a direct dependency on that class.
 */
export type ClearPendingRequestCallback = (conversationContext: ConversationContext | undefined) => Promise<void>;
/**
 * @class GMIChunkTransformer
 * @description
 * Provides the data-transformation bridge between GMI and AgentOS:
 *
 * - **processGMIOutput** - Converts a non-streaming {@link GMIOutput} (returned
 *   by `handleToolResult` or the generator return value) into AgentOS response
 *   chunks (text deltas, UI commands, errors, final responses).
 *
 * - **transformAndPushGMIChunk** - Maps a single streaming {@link GMIOutputChunk}
 *   to the corresponding {@link AgentOSResponseChunkType} and pushes it.
 *
 * - **constructGMITurnInput** - Builds a {@link GMITurnInput} from an
 *   {@link AgentOSInput}, performing interaction type detection (text /
 *   multimodal / system) and metadata assembly.
 *
 * - **filterTurnPlanForDisabledSessionSkills** - Removes disabled skills from
 *   a turn plan's capability discovery results.
 *
 * All chunk emission is delegated to the shared {@link StreamChunkEmitter}.
 */
export declare class GMIChunkTransformer {
    private readonly activeStreamContexts;
    private readonly chunks;
    private readonly dependencies;
    private readonly enableConversationalPersistence;
    private clearPendingRequest;
    private readonly capabilityContextAssembler;
    /**
     * Creates a GMIChunkTransformer.
     *
     * @param activeStreamContexts - Shared mutable map of active stream contexts.
     *   The transformer deletes entries when a stream reaches a terminal state
     *   (error or final response).
     * @param chunks - Delegate for assembling and emitting response chunks.
     * @param dependencies - Injected service dependencies (streamingManager,
     *   conversationManager).
     * @param enableConversationalPersistence - Whether to persist messages.
     * @param clearPendingRequest - Callback to clear pending external tool requests
     *   from conversation metadata.
     */
    constructor(activeStreamContexts: Map<string, TransformerStreamContext>, chunks: StreamChunkEmitter, dependencies: AgentOSOrchestratorDependencies, enableConversationalPersistence: boolean, clearPendingRequest: ClearPendingRequestCallback);
    /**
     * Replaces the clearPendingRequest callback after construction.
     *
     * @param cb - The new callback.
     */
    setClearPendingRequestCallback(cb: ClearPendingRequestCallback): void;
    /**
     * Processes a non-streaming {@link GMIOutput} (typically from
     * `handleToolResult` or the generator return value) and pushes the
     * corresponding AgentOS response chunks.
     *
     * Handles:
     * - Response text emission as TEXT_DELTA
     * - UI command emission
     * - Error handling with stream cleanup
     * - Final response emission with conversation persistence
     *
     * @param agentOSStreamId - The orchestrator stream ID.
     * @param streamContext - Active stream context for this interaction.
     * @param gmiOutput - The GMI output to transform.
     * @param _isContinuation - Whether this output is from an internal GMI
     *   continuation (currently informational only).
     */
    processGMIOutput(agentOSStreamId: string, streamContext: TransformerStreamContext, gmiOutput: GMIOutput, _isContinuation: boolean): Promise<void>;
    /**
     * Transforms a single streaming {@link GMIOutputChunk} into the corresponding
     * AgentOS response chunk type and pushes it via the {@link StreamChunkEmitter}.
     *
     * Supported chunk type mappings:
     * - TEXT_DELTA -> AgentOSResponseChunkType.TEXT_DELTA
     * - SYSTEM_MESSAGE -> AgentOSResponseChunkType.SYSTEM_PROGRESS
     * - TOOL_CALL_REQUEST -> AgentOSResponseChunkType.TOOL_CALL_REQUEST
     * - UI_COMMAND -> AgentOSResponseChunkType.UI_COMMAND
     * - ERROR -> pushError (with optional stream close on isFinal)
     * - FINAL_RESPONSE_MARKER -> no-op (consumed internally)
     * - USAGE_UPDATE -> logged to console
     *
     * @param agentOSStreamId - The orchestrator stream ID.
     * @param streamContext - Active stream context.
     * @param gmiChunk - The GMI output chunk to transform.
     */
    transformAndPushGMIChunk(agentOSStreamId: string, streamContext: TransformerStreamContext, gmiChunk: GMIOutputChunk): Promise<void>;
    /**
     * Constructs a {@link GMITurnInput} from an {@link AgentOSInput} and the
     * active stream context. Performs interaction type detection (text, multimodal,
     * system message) and assembles all metadata required by the GMI.
     *
     * @param agentOSStreamId - The orchestrator stream ID.
     * @param input - The AgentOS-level input for this turn.
     * @param streamContext - Active stream context.
     * @returns The constructed GMI turn input.
     */
    constructGMITurnInput(agentOSStreamId: string, input: AgentOSInput, streamContext: TransformerStreamContext): GMITurnInput;
    /**
     * Filters a turn plan's capability discovery results by removing any
     * capabilities that belong to skills disabled for this session.
     *
     * @param turnPlan - The turn plan to filter (may be null).
     * @param input - The AgentOS input containing disabled skill IDs.
     * @returns The filtered turn plan, or the original if no filtering was needed.
     */
    filterTurnPlanForDisabledSessionSkills(turnPlan: TurnPlan | null, input: AgentOSInput): TurnPlan | null;
}
//# sourceMappingURL=GMIChunkTransformer.d.ts.map