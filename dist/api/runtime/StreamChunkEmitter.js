/**
 * @fileoverview Stream chunk assembly and emission delegate.
 * Extracted from AgentOSOrchestrator for focused chunk construction logic.
 */
import { AgentOSResponseChunkType, } from '../types/AgentOSResponse.js';
import { GMIErrorCode } from '@framers/agentos/core/utils/errors';
import { normalizeUsage } from '../../orchestration/turn-planner/helpers.js';
import { getActiveTraceMetadata, shouldIncludeTraceInAgentOSResponses, } from '../../evaluation/observability/otel.js';
/**
 * Assembles and emits AgentOS response chunks via a StreamingManager.
 * Takes a reference to the active stream contexts map for language negotiation metadata.
 */
export class StreamChunkEmitter {
    constructor(streamingManager, activeStreamContexts) {
        this.streamingManager = streamingManager;
        this.activeStreamContexts = activeStreamContexts;
    }
    async pushChunk(streamId, type, gmiInstanceId, personaId, isFinal, data) {
        const baseChunk = {
            type,
            streamId,
            gmiInstanceId,
            personaId,
            isFinal,
            timestamp: new Date().toISOString(),
        };
        if (data && typeof data === 'object' && 'metadata' in data && data.metadata) {
            baseChunk.metadata = data.metadata;
        }
        const ctx = this.activeStreamContexts.get(streamId);
        if (ctx?.languageNegotiation) {
            baseChunk.metadata = baseChunk.metadata || {};
            if (!baseChunk.metadata.language)
                baseChunk.metadata.language = ctx.languageNegotiation;
        }
        if (shouldIncludeTraceInAgentOSResponses() &&
            (type === AgentOSResponseChunkType.METADATA_UPDATE ||
                type === AgentOSResponseChunkType.FINAL_RESPONSE ||
                type === AgentOSResponseChunkType.ERROR)) {
            const traceMeta = getActiveTraceMetadata();
            if (traceMeta) {
                baseChunk.metadata = baseChunk.metadata || {};
                baseChunk.metadata.trace = traceMeta;
            }
        }
        let chunk;
        switch (type) {
            case AgentOSResponseChunkType.TEXT_DELTA:
                chunk = { ...baseChunk, textDelta: data.textDelta };
                break;
            case AgentOSResponseChunkType.SYSTEM_PROGRESS:
                chunk = {
                    ...baseChunk,
                    message: data.message,
                    progressPercentage: data.progressPercentage,
                    statusCode: data.statusCode,
                };
                break;
            case AgentOSResponseChunkType.TOOL_CALL_REQUEST:
                chunk = {
                    ...baseChunk,
                    toolCalls: data.toolCalls,
                    rationale: data.rationale,
                    executionMode: data.executionMode,
                    requiresExternalToolResult: data.requiresExternalToolResult,
                };
                break;
            case AgentOSResponseChunkType.TOOL_RESULT_EMISSION:
                chunk = {
                    ...baseChunk,
                    toolCallId: data.toolCallId,
                    toolName: data.toolName,
                    toolResult: data.toolResult,
                    isSuccess: data.isSuccess,
                    errorMessage: data.errorMessage,
                };
                break;
            case AgentOSResponseChunkType.UI_COMMAND:
                chunk = { ...baseChunk, uiCommands: data.uiCommands };
                break;
            case AgentOSResponseChunkType.ERROR:
                chunk = {
                    ...baseChunk,
                    code: data.code,
                    message: data.message,
                    details: data.details,
                };
                break;
            case AgentOSResponseChunkType.FINAL_RESPONSE:
                chunk = {
                    ...baseChunk,
                    finalResponseText: data.finalResponseText,
                    finalToolCalls: data.finalToolCalls,
                    finalUiCommands: data.finalUiCommands,
                    audioOutput: data.audioOutput,
                    imageOutput: data.imageOutput,
                    usage: normalizeUsage(data.usage),
                    reasoningTrace: data.reasoningTrace,
                    error: data.error,
                    updatedConversationContext: data.updatedConversationContext,
                    activePersonaDetails: data.activePersonaDetails,
                };
                break;
            case AgentOSResponseChunkType.WORKFLOW_UPDATE:
                chunk = { ...baseChunk, workflow: data.workflow };
                break;
            case AgentOSResponseChunkType.METADATA_UPDATE:
                chunk = { ...baseChunk, updates: data.updates };
                break;
            default:
                console.error(`StreamChunkEmitter: Unknown chunk type: ${type}`);
                chunk = {
                    ...baseChunk,
                    type: AgentOSResponseChunkType.ERROR,
                    code: GMIErrorCode.INTERNAL_SERVER_ERROR,
                    message: `Unknown chunk type: ${type}`,
                    details: data,
                };
        }
        try {
            await this.streamingManager.pushChunk(streamId, chunk);
        }
        catch (pushError) {
            console.error(`StreamChunkEmitter: Failed to push chunk to stream ${streamId}. Type: ${type}. Error: ${pushError?.message}`, pushError);
        }
    }
    async pushError(streamId, personaId, gmiInstanceId = 'unknown_gmi_instance', code, message, details) {
        await this.pushChunk(streamId, AgentOSResponseChunkType.ERROR, gmiInstanceId, personaId, true, { code: code.toString(), message, details });
    }
    async emitLifecycleUpdate(args) {
        await this.pushChunk(args.streamId, AgentOSResponseChunkType.METADATA_UPDATE, args.gmiInstanceId, args.personaId, false, {
            updates: {
                executionLifecycle: {
                    phase: args.phase,
                    status: args.status,
                    timestamp: new Date().toISOString(),
                    ...(args.details ? { details: args.details } : null),
                },
            },
        });
    }
}
//# sourceMappingURL=StreamChunkEmitter.js.map