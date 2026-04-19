/**
 * @fileoverview Stream chunk assembly and emission delegate.
 * Extracted from AgentOSOrchestrator for focused chunk construction logic.
 */
import type { StreamId, StreamingManager } from '../../core/streaming/StreamingManager';
import { AgentOSResponseChunkType } from '../types/AgentOSResponse';
import { GMIErrorCode } from '@framers/agentos/core/utils/errors';
type TurnExecutionLifecyclePhase = 'planned' | 'executing' | 'degraded' | 'recovered' | 'completed' | 'errored';
interface StreamContext {
    languageNegotiation?: any;
}
/**
 * Assembles and emits AgentOS response chunks via a StreamingManager.
 * Takes a reference to the active stream contexts map for language negotiation metadata.
 */
export declare class StreamChunkEmitter {
    private readonly streamingManager;
    private readonly activeStreamContexts;
    constructor(streamingManager: StreamingManager, activeStreamContexts: Map<string, StreamContext>);
    pushChunk(streamId: StreamId, type: AgentOSResponseChunkType, gmiInstanceId: string, personaId: string, isFinal: boolean, data: any): Promise<void>;
    pushError(streamId: StreamId, personaId: string, gmiInstanceId: string | undefined, code: GMIErrorCode | string, message: string, details?: any): Promise<void>;
    emitLifecycleUpdate(args: {
        streamId: StreamId;
        gmiInstanceId: string;
        personaId: string;
        phase: TurnExecutionLifecyclePhase;
        status: 'ok' | 'degraded' | 'error';
        details?: Record<string, unknown>;
    }): Promise<void>;
}
export {};
//# sourceMappingURL=StreamChunkEmitter.d.ts.map