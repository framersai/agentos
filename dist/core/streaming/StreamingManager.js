// File: src/core/streaming/StreamingManager.ts
/**
 * @fileoverview Implements the StreamingManager, a core component responsible for
 * managing real-time data streams within AgentOS. It handles the lifecycle of streams,
 * registration of clients to streams, and distribution of data chunks to subscribed clients.
 * This manager is designed for robustness, scalability (conceptual), and clear error handling.
 *
 * @module backend/core/streaming/StreamingManager
 * @see ./IStreamClient.ts For the client contract.
 * @see ../../api/types/AgentOSResponse.ts For the data chunk structure.
 */
import { uuidv4 } from '../../core/utils/uuid.js';
import { AgentOSResponseChunkType } from '../../api/types/AgentOSResponse.js';
import { GMIError, GMIErrorCode } from '../../core/utils/errors.js'; // Corrected path
/**
 * Custom error class for errors originating from the StreamingManager.
 * @class StreamError
 * @extends {GMIError}
 */
export class StreamError extends GMIError {
    /**
     * Creates an instance of StreamError.
     * @param {string} message - The human-readable error message.
     * @param {GMIErrorCode | string} code - A specific error code (can be from GMIErrorCode or custom).
     * @param {StreamId} [streamId] - The ID of the stream involved.
     * @param {StreamClientId} [clientId] - The ID of the client involved.
     * @param {any} [details] - Optional additional context or the underlying error.
     */
    constructor(message, code, streamId, clientId, details) {
        super(message, code, details);
        this.name = 'StreamError'; // This is standard for custom errors extending Error
        this.streamId = streamId;
        this.clientId = clientId;
        Object.setPrototypeOf(this, StreamError.prototype);
    }
}
/**
 * @class StreamingManager
 * @implements {IStreamingManager}
 * Manages real-time data streams for AgentOS, handling client subscriptions
 * and chunk distribution.
 */
export class StreamingManager {
    constructor() {
        this.isInitialized = false;
        this.managerId = `streaming-mgr-${uuidv4()}`;
        this.activeStreams = new Map();
    }
    /** @inheritdoc */
    async initialize(config) {
        if (this.isInitialized) {
            console.warn(`StreamingManager (ID: ${this.managerId}) already initialized. Re-initializing.`);
            await this.shutdown(true);
        }
        this.config = Object.freeze({
            maxConcurrentStreams: config.maxConcurrentStreams === undefined || config.maxConcurrentStreams <= 0 ? Infinity : config.maxConcurrentStreams,
            defaultStreamInactivityTimeoutMs: config.defaultStreamInactivityTimeoutMs === undefined ? 300000 : config.defaultStreamInactivityTimeoutMs,
            maxClientsPerStream: config.maxClientsPerStream === undefined || config.maxClientsPerStream <= 0 ? Infinity : config.maxClientsPerStream,
            onClientSendErrorBehavior: config.onClientSendErrorBehavior || 'log_and_continue',
        });
        this.isInitialized = true;
        console.log(`StreamingManager (ID: ${this.managerId}) initialized. Config:`, JSON.stringify(this.config));
    }
    /**
     * Ensures the manager has been properly initialized before any operations.
     * @private
     * @throws {StreamError} If the engine is not initialized.
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new StreamError(`StreamingManager (ID: ${this.managerId}) is not initialized. Call initialize() first.`, GMIErrorCode.NOT_INITIALIZED);
        }
    }
    /** @inheritdoc */
    async createStream(requestedStreamId) {
        this.ensureInitialized();
        if (this.activeStreams.size >= this.config.maxConcurrentStreams) {
            throw new StreamError('Maximum number of concurrent streams reached.', GMIErrorCode.RATE_LIMIT_EXCEEDED, undefined, undefined, { maxStreams: this.config.maxConcurrentStreams });
        }
        let streamId = requestedStreamId || uuidv4();
        if (this.activeStreams.has(streamId)) {
            if (requestedStreamId) {
                throw new StreamError(`Stream with requested ID '${streamId}' already exists.`, GMIErrorCode.RESOURCE_ALREADY_EXISTS, streamId);
            }
            streamId = uuidv4();
        }
        const now = Date.now();
        const newStream = {
            id: streamId,
            clients: new Map(),
            createdAt: now,
            lastActivityAt: now,
            metadata: {}, // Initialize empty metadata
        };
        this.activeStreams.set(streamId, newStream);
        console.log(`StreamingManager (ID: ${this.managerId}): Stream '${streamId}' created.`);
        return streamId;
    }
    /** @inheritdoc */
    async registerClient(streamId, client) {
        this.ensureInitialized();
        const stream = this.activeStreams.get(streamId);
        if (!stream) {
            throw new StreamError(`Stream with ID '${streamId}' not found. Cannot register client.`, GMIErrorCode.RESOURCE_NOT_FOUND, streamId);
        }
        if (stream.clients.has(client.id)) {
            console.warn(`StreamingManager (ID: ${this.managerId}): Client '${client.id}' is already registered to stream '${streamId}'. Ignoring.`);
            return;
        }
        if (stream.clients.size >= this.config.maxClientsPerStream) {
            throw new StreamError(`Maximum number of clients reached for stream '${streamId}'.`, GMIErrorCode.RATE_LIMIT_EXCEEDED, streamId, client.id, { maxClients: this.config.maxClientsPerStream });
        }
        stream.clients.set(client.id, client);
        stream.lastActivityAt = Date.now();
        console.log(`StreamingManager (ID: ${this.managerId}): Client '${client.id}' registered to stream '${streamId}'. Total clients: ${stream.clients.size}.`);
    }
    /** @inheritdoc */
    async deregisterClient(streamId, clientId) {
        this.ensureInitialized();
        const stream = this.activeStreams.get(streamId);
        if (!stream) {
            console.warn(`StreamingManager (ID: ${this.managerId}): Stream '${streamId}' not found during deregisterClient for client '${clientId}'. Client is effectively deregistered.`);
            return;
        }
        if (!stream.clients.has(clientId)) {
            console.warn(`StreamingManager (ID: ${this.managerId}): Client '${clientId}' not found in stream '${streamId}' during deregistration attempt.`);
            return;
        }
        const clientInstance = stream.clients.get(clientId);
        stream.clients.delete(clientId);
        stream.lastActivityAt = Date.now();
        console.log(`StreamingManager (ID: ${this.managerId}): Client '${clientId}' deregistered from stream '${streamId}'. Remaining clients: ${stream.clients.size}.`);
        if (clientInstance?.close && typeof clientInstance.close === 'function') {
            try {
                await clientInstance.close('Deregistered by StreamingManager.');
            }
            catch (closeError) {
                console.error(`StreamingManager (ID: ${this.managerId}): Error closing client '${clientId}' during deregistration: ${closeError.message}`, closeError);
            }
        }
    }
    /** @inheritdoc */
    async pushChunk(streamId, chunk) {
        this.ensureInitialized();
        const stream = this.activeStreams.get(streamId);
        if (!stream) {
            console.warn(`StreamingManager (ID: ${this.managerId}): Attempted to push chunk to closed/non-existent stream '${streamId}'. Chunk type=${chunk.type}.`);
            return;
        }
        stream.lastActivityAt = Date.now();
        // Update stream metadata if chunk contains relevant info (e.g., GMI instance ID)
        if (chunk.gmiInstanceId && stream.metadata && !stream.metadata.gmiInstanceId) {
            stream.metadata.gmiInstanceId = chunk.gmiInstanceId;
        }
        if (chunk.personaId && stream.metadata && !stream.metadata.personaId) {
            stream.metadata.personaId = chunk.personaId;
        }
        const deliveryPromises = [];
        const failedClientIds = [];
        for (const [clientId, client] of stream.clients.entries()) {
            if (client.isActive()) {
                const sendPromise = client.sendChunk(chunk)
                    .catch(async (error) => {
                    console.error(`StreamingManager (ID: ${this.managerId}): Failed to send chunk to client '${clientId}' on stream '${streamId}'. Behavior: '${this.config.onClientSendErrorBehavior}'. Error: ${error.message}`, error);
                    failedClientIds.push(clientId);
                    if (this.config.onClientSendErrorBehavior === 'throw') {
                        throw new StreamError(`Failed to send chunk to client '${clientId}'. Original error: ${error.message}`, GMIErrorCode.STREAM_ERROR, streamId, clientId, error);
                    }
                });
                deliveryPromises.push(sendPromise);
            }
            else {
                console.warn(`StreamingManager (ID: ${this.managerId}): Client '${clientId}' on stream '${streamId}' is inactive. Marking for potential deregistration.`);
                failedClientIds.push(clientId);
            }
        }
        await Promise.allSettled(deliveryPromises);
        if ((this.config.onClientSendErrorBehavior === 'deregister_client' || this.config.onClientSendErrorBehavior === 'log_and_continue') && failedClientIds.length > 0) {
            for (const clientId of failedClientIds) {
                if (stream.clients.has(clientId)) {
                    console.log(`StreamingManager (ID: ${this.managerId}): Deregistering client '${clientId}' from stream '${streamId}' due to send error/inactivity.`);
                    await this.deregisterClient(streamId, clientId).catch(deregError => {
                        console.error(`StreamingManager (ID: ${this.managerId}): Error auto-deregistering client '${clientId}': ${deregError.message}`, deregError);
                    });
                }
            }
        }
    }
    /** @inheritdoc */
    async closeStream(streamId, reason) {
        this.ensureInitialized();
        const stream = this.activeStreams.get(streamId);
        if (!stream) {
            console.warn(`StreamingManager (ID: ${this.managerId}): Attempted to close non-existent stream '${streamId}'.`);
            return;
        }
        console.log(`StreamingManager (ID: ${this.managerId}): Closing stream '${streamId}'. Reason: ${reason || 'N/A'}. Notifying ${stream.clients.size} clients.`);
        const clientNotificationPromises = [];
        for (const client of stream.clients.values()) {
            clientNotificationPromises.push(client.notifyStreamClosed(reason)
                .catch(error => console.error(`StreamingManager (ID: ${this.managerId}): Error notifying client '${client.id}' about stream '${streamId}' closure: ${error.message}`, error)));
            if (client.close && typeof client.close === 'function') {
                clientNotificationPromises.push(client.close(`Stream '${streamId}' closed: ${reason || 'No reason provided.'}`)
                    .catch(closeError => console.error(`StreamingManager (ID: ${this.managerId}): Error closing client connection '${client.id}' for stream '${streamId}': ${closeError.message}`, closeError)));
            }
        }
        await Promise.allSettled(clientNotificationPromises);
        this.activeStreams.delete(streamId);
        console.log(`StreamingManager (ID: ${this.managerId}): Stream '${streamId}' and its client references removed.`);
    }
    /** @inheritdoc */
    async handleStreamError(streamId, error, terminateStream = true) {
        this.ensureInitialized();
        const stream = this.activeStreams.get(streamId);
        if (!stream) {
            console.error(`StreamingManager (ID: ${this.managerId}): Received error for non-existent stream '${streamId}'. Error: ${error.message}`, error);
            return;
        }
        console.error(`StreamingManager (ID: ${this.managerId}): Handling error on stream '${streamId}'. Error: ${error.message}. Terminate: ${terminateStream}`, error);
        const errorChunk = {
            type: AgentOSResponseChunkType.ERROR,
            streamId: streamId,
            gmiInstanceId: stream.metadata?.gmiInstanceId || 'unknown_gmi',
            personaId: stream.metadata?.personaId || 'unknown_persona',
            isFinal: true,
            timestamp: new Date().toISOString(),
            // Accessing error.code is fine if error is GMIError, but not if it's a base Error.
            // The type guard correctly handles this.
            code: (error instanceof GMIError) ? error.code : GMIErrorCode.STREAM_ERROR,
            message: error.message,
            // Accessing error.details is fine if error is GMIError.
            // The type guard handles this. The fallback for details for a generic Error is also fine.
            details: (error instanceof GMIError) ? error.details : { name: error.name, stack: error.stack },
        };
        try {
            await this.pushChunk(streamId, errorChunk);
        }
        catch (pushError) {
            console.error(`StreamingManager (ID: ${this.managerId}): Failed to push error chunk to clients of stream '${streamId}'. Push error: ${pushError.message}`, pushError);
        }
        if (terminateStream) {
            await this.closeStream(streamId, `Stream terminated due to error: ${error.message}`);
        }
    }
    /** @inheritdoc */
    async getActiveStreamIds() {
        this.ensureInitialized();
        return Array.from(this.activeStreams.keys());
    }
    /** @inheritdoc */
    async getClientCountForStream(streamId) {
        this.ensureInitialized();
        const stream = this.activeStreams.get(streamId);
        if (!stream) {
            throw new StreamError(`Stream with ID '${streamId}' not found.`, GMIErrorCode.RESOURCE_NOT_FOUND, streamId);
        }
        return stream.clients.size;
    }
    /** @inheritdoc */
    async shutdown(isReinitializing = false) {
        if (!this.isInitialized && !isReinitializing) {
            console.warn(`StreamingManager (ID: ${this.managerId}) shutdown called but was not initialized or already shut down.`);
            return;
        }
        console.log(`StreamingManager (ID: ${this.managerId}): Shutting down... Closing ${this.activeStreams.size} active streams.`);
        const streamIdsToClose = Array.from(this.activeStreams.keys());
        for (const streamId of streamIdsToClose) {
            try {
                await this.closeStream(streamId, 'StreamingManager is shutting down.');
            }
            catch (error) {
                console.error(`StreamingManager (ID: ${this.managerId}): Error closing stream '${streamId}' during shutdown: ${error.message}`, error);
            }
        }
        this.activeStreams.clear();
        if (!isReinitializing) {
            this.isInitialized = false;
        }
        console.log(`StreamingManager (ID: ${this.managerId}): Shutdown complete. All streams closed and cache cleared.`);
    }
}
//# sourceMappingURL=StreamingManager.js.map