/**
 * @fileoverview Pre-GMI turn preparation pipeline.
 *
 * This class encapsulates the 12 pre-LLM-call phases of a turn:
 * GMI acquisition, turn planning, capability discovery, adaptive execution
 * policies, organization context resolution, long-term memory policy,
 * inbound message persistence, rolling summary compaction, prompt profile
 * routing, long-term memory retrieval, conversation history assembly,
 * and metadata/memory-sink persistence.
 *
 * The pipeline produces a {@link PreparedTurnContext} that the orchestrator
 * consumes to run the GMI tool-call loop and finalize the response.
 *
 * Extracted from AgentOSOrchestrator to reduce the size of
 * `_processTurnInternal` and improve testability of the pre-LLM pipeline.
 *
 * @module backend/agentos/api/TurnExecutionPipeline
 */
import type { StreamId } from '../../core/streaming/StreamingManager';
import type { StreamChunkEmitter } from './StreamChunkEmitter';
import type { AgentOSOrchestratorDependencies } from '../types/OrchestratorConfig';
import type { AgentOSInput } from '../types/AgentOSInput';
import type { GMIChunkTransformer } from './GMIChunkTransformer';
import type { TaskOutcomeTelemetryManager } from './TaskOutcomeTelemetryManager';
import type { ConversationContext } from '../../core/conversation/ConversationContext';
import type { IGMI, GMITurnInput } from '../../cognitive_substrate/IGMI';
import type { RollingSummaryCompactionConfig } from '../../core/conversation/RollingSummaryCompactor';
import { type ResolvedLongTermMemoryPolicy } from '../../core/conversation/LongTermMemoryPolicy';
import type { LongTermMemoryRecallProfile } from '../types/OrchestratorConfig';
/**
 * Minimal stream context shape, matching the ActiveStreamContext used by
 * the orchestrator and other extracted classes.
 */
export interface PipelineStreamContext {
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
 * Result of the pre-LLM turn preparation pipeline.
 *
 * Contains all the hydrated state that the orchestrator needs to run the
 * GMI tool-call loop and finalize the turn.
 */
export interface PreparedTurnContext {
    /** The GMI instance for this turn. */
    gmi: IGMI;
    /** The hydrated conversation context. */
    conversationContext: ConversationContext;
    /** The resolved persona ID from the GMI. */
    currentPersonaId: string;
    /** The GMI instance ID used for chunk attribution. */
    gmiInstanceIdForChunks: string;
    /** The constructed GMI input for this turn. */
    gmiInput: GMITurnInput;
    /** The active stream context (registered in the shared map). */
    streamContext: PipelineStreamContext;
    /** The resolved organization ID for memory scoping. */
    organizationIdForMemory: string | undefined;
    /** The resolved long-term memory policy for this turn. */
    longTermMemoryPolicy: ResolvedLongTermMemoryPolicy | null;
    /** Whether the turn was planned with a degraded/fallback path. */
    lifecycleDegraded: boolean;
    /** Long-term memory feedback payload (for recording feedback after the turn). */
    longTermMemoryFeedbackPayload: any;
    /** Long-term memory retrieval diagnostics. */
    longTermMemoryRetrievalDiagnostics: any;
    /** The user query text used for long-term memory retrieval. */
    longTermMemoryQueryText: string | undefined;
}
/**
 * Resolved config shape consumed by the pipeline.
 * Extracted from the orchestrator's full resolved config to avoid coupling.
 */
export interface TurnPipelineConfig {
    enableConversationalPersistence: boolean;
    maxToolCallIterations: number;
    promptProfileConfig: any;
    rollingSummaryCompactionConfig: RollingSummaryCompactionConfig | null;
    rollingSummaryCompactionProfilesConfig: any;
    rollingSummarySystemPrompt: string;
    rollingSummaryStateKey: string;
    longTermMemoryRecall: {
        profile: LongTermMemoryRecallProfile;
        cadenceTurns: number;
        forceOnCompaction: boolean;
        maxContextChars: number;
        topKByScope: Record<'user' | 'persona' | 'organization', number>;
    };
    tenantRouting: {
        mode: 'multi_tenant' | 'single_tenant';
        defaultOrganizationId?: string;
        strictOrganizationIsolation: boolean;
    };
    taskOutcomeTelemetry: any;
    adaptiveExecution: any;
}
/**
 * @class TurnExecutionPipeline
 * @description
 * Runs the 12 pre-LLM phases of a turn and produces a {@link PreparedTurnContext}.
 *
 * **Phase sequence:**
 * 1. Validate input (selectedPersonaId required)
 * 2. GMI acquisition via `getOrCreateGMIForSession`
 * 3. Stream context registration
 * 4. GMI input construction (delegates to {@link GMIChunkTransformer})
 * 5. Turn planning via ITurnPlanner
 * 6. Adaptive execution policy application
 * 7. Organization context and long-term memory policy resolution
 * 8. Inbound message persistence
 * 9. Rolling summary compaction
 * 10. Prompt profile routing
 * 11. Long-term memory retrieval
 * 12. Conversation history assembly, metadata persistence, memory sink,
 *     and metadata chunk emission
 *
 * The orchestrator calls `prepareTurn()` and then uses the returned context
 * to drive the GMI streaming loop.
 */
export declare class TurnExecutionPipeline {
    private readonly activeStreamContexts;
    private readonly chunks;
    private readonly dependencies;
    private readonly config;
    private readonly chunkTransformer;
    private readonly telemetry;
    private readonly resolveOrganizationContext;
    /**
     * Creates a TurnExecutionPipeline.
     *
     * @param activeStreamContexts - Shared mutable map of active stream contexts.
     * @param chunks - Delegate for assembling and emitting response chunks.
     * @param dependencies - Injected service dependencies.
     * @param config - Resolved orchestrator config for this pipeline's needs.
     * @param chunkTransformer - For constructing GMI input and filtering turn plans.
     * @param telemetry - For adaptive execution policy decisions.
     * @param resolveOrganizationContext - Callback to resolve tenant org context.
     */
    constructor(activeStreamContexts: Map<string, PipelineStreamContext>, chunks: StreamChunkEmitter, dependencies: AgentOSOrchestratorDependencies, config: TurnPipelineConfig, chunkTransformer: GMIChunkTransformer, telemetry: TaskOutcomeTelemetryManager, resolveOrganizationContext: (inputOrganizationId: unknown) => string | undefined);
    /**
     * Executes the pre-LLM turn preparation pipeline.
     *
     * @param agentOSStreamId - The stream ID allocated for this turn.
     * @param input - The AgentOS-level input for this turn.
     * @returns A {@link PreparedTurnContext} containing everything the
     *   orchestrator needs to drive the GMI streaming loop.
     * @throws {GMIError} If validation fails, GMI acquisition fails, or
     *   turn planning raises a fatal error.
     */
    prepareTurn(agentOSStreamId: StreamId, input: AgentOSInput): Promise<PreparedTurnContext>;
}
//# sourceMappingURL=TurnExecutionPipeline.d.ts.map