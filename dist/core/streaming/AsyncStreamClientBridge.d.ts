/**
 * @fileoverview Push-to-pull streaming adapter for AgentOS responses.
 *
 * Bridges the push-based StreamingManager to a pull-based AsyncGenerator
 * consumable by AgentOS.processRequest and similar facades.
 */
import type { IStreamClient, StreamClientId } from './IStreamClient';
import type { AgentOSResponse } from '../../api/types/AgentOSResponse';
/**
 * Acts as an IStreamClient to bridge push-based data flow from StreamingManager
 * to a pull-based AsyncGenerator. Queues incoming chunks and uses promises to
 * signal availability to a consuming async generator loop.
 */
export declare class AsyncStreamClientBridge implements IStreamClient {
    readonly id: StreamClientId;
    private readonly chunkQueue;
    private resolveNextChunkPromise;
    private rejectNextChunkPromise;
    private streamClosed;
    private processingError;
    constructor(debugIdPrefix?: string);
    sendChunk(chunk: AgentOSResponse): Promise<void>;
    notifyStreamClosed(reason?: string): Promise<void>;
    forceClose(): void;
    isActive(): boolean;
    close(reason?: string): Promise<void>;
    consume(): AsyncGenerator<AgentOSResponse, void, undefined>;
}
//# sourceMappingURL=AsyncStreamClientBridge.d.ts.map