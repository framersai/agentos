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
import { AgentOSResponse } from '../../api/types/AgentOSResponse';
import { IStreamClient, StreamClientId } from './IStreamClient';
import { GMIError, GMIErrorCode } from '@framers/agentos/core/utils/errors';
/**
 * Represents a unique identifier for a data stream.
 * @typedef {string} StreamId
 */
export type StreamId = string;
/**
 * Configuration options for the StreamingManager.
 * @interface StreamingManagerConfig
 */
export interface StreamingManagerConfig {
    /**
     * Maximum number of concurrent active streams allowed.
     * If set to 0 or a negative number, it implies no limit (not recommended for production).
     * @type {number}
     * @default 1000
     */
    maxConcurrentStreams?: number;
    /**
     * Default timeout in milliseconds for a stream if no activity is detected.
     * If set to 0, streams do not time out automatically. (Conceptual, requires active tracking)
     * @type {number}
     * @default 300000 (5 minutes)
     */
    defaultStreamInactivityTimeoutMs?: number;
    /**
     * Maximum number of clients allowed to subscribe to a single stream.
     * If set to 0 or a negative number, it implies no limit.
     * @type {number}
     * @default 10
     */
    maxClientsPerStream?: number;
    /**
     * Optional: Defines the behavior when trying to push a chunk to a client whose `sendChunk` method fails.
     * - 'log_and_continue': Logs the error and continues sending to other clients. (Default)
     * - 'deregister_client': Logs the error, attempts to deregister the failing client, and continues.
     * - 'throw': Throws an error, potentially stopping the push operation for the current chunk to other clients.
     * @type {'log_and_continue' | 'deregister_client' | 'throw'}
     * @default 'log_and_continue'
     */
    onClientSendErrorBehavior?: 'log_and_continue' | 'deregister_client' | 'throw';
}
/**
 * Custom error class for errors originating from the StreamingManager.
 * @class StreamError
 * @extends {GMIError}
 */
export declare class StreamError extends GMIError {
    /**
     * The ID of the stream involved in the error, if applicable.
     * @public
     * @readonly
     * @type {StreamId | undefined}
     */
    readonly streamId?: StreamId;
    /**
     * The ID of the client involved in the error, if applicable.
     * @public
     * @readonly
     * @type {StreamClientId | undefined}
     */
    readonly clientId?: StreamClientId;
    /**
     * Creates an instance of StreamError.
     * @param {string} message - The human-readable error message.
     * @param {GMIErrorCode | string} code - A specific error code (can be from GMIErrorCode or custom).
     * @param {StreamId} [streamId] - The ID of the stream involved.
     * @param {StreamClientId} [clientId] - The ID of the client involved.
     * @param {any} [details] - Optional additional context or the underlying error.
     */
    constructor(message: string, code: GMIErrorCode | string, streamId?: StreamId, clientId?: StreamClientId, details?: any);
}
/**
 * @interface IStreamingManager
 * @description Defines the contract for the StreamingManager service.
 * This service is responsible for creating, managing, and terminating data streams,
 * as well as handling client subscriptions and data distribution.
 */
export interface IStreamingManager {
    /**
     * Initializes the StreamingManager with its configuration.
     * This method must be called successfully before any other operations.
     *
     * @public
     * @async
     * @param {StreamingManagerConfig} config - The configuration for the manager.
     * @returns {Promise<void>} A promise that resolves upon successful initialization.
     * @throws {GMIError} If configuration is invalid or initialization fails.
     */
    initialize(config: StreamingManagerConfig): Promise<void>;
    /**
     * Creates a new data stream and returns its unique ID.
     *
     * @public
     * @param {StreamId} [requestedStreamId] - Optional. If provided, attempts to use this ID.
     * If not provided or if the ID already exists, a new unique ID will be generated.
     * @returns {Promise<StreamId>} A promise resolving to the unique ID of the created stream.
     * @throws {StreamError} If the maximum number of concurrent streams is reached,
     * or if a `requestedStreamId` is provided but already in use (and regeneration is not supported/fails).
     */
    createStream(requestedStreamId?: StreamId): Promise<StreamId>;
    /**
     * Registers a client to a specific stream to receive data chunks.
     *
     * @public
     * @async
     * @param {StreamId} streamId - The ID of the stream to subscribe to.
     * @param {IStreamClient} client - The client instance that implements `IStreamClient`.
     * @returns {Promise<void>} A promise that resolves when the client is successfully registered.
     * @throws {StreamError} If the stream does not exist, if the client is already registered,
     * or if the maximum number of clients for the stream is reached.
     */
    registerClient(streamId: StreamId, client: IStreamClient): Promise<void>;
    /**
     * Deregisters a client from a specific stream.
     * The client will no longer receive data chunks for this stream.
     *
     * @public
     * @async
     * @param {StreamId} streamId - The ID of the stream to unsubscribe from.
     * @param {StreamClientId} clientId - The ID of the client to deregister.
     * @returns {Promise<void>} A promise that resolves when the client is successfully deregistered.
     * @throws {StreamError} If the stream or client does not exist within that stream.
     */
    deregisterClient(streamId: StreamId, clientId: StreamClientId): Promise<void>;
    /**
     * Pushes a data chunk to all clients currently subscribed to the specified stream.
     *
     * @public
     * @async
     * @param {StreamId} streamId - The ID of the stream to push data to.
     * @param {AgentOSResponse} chunk - The data chunk to distribute.
     * @returns {Promise<void>} A promise that resolves when the chunk has been pushed to all
     * active clients of the stream (or attempted, based on `onClientSendErrorBehavior`).
     * @throws {StreamError} If the stream does not exist, or if `onClientSendErrorBehavior` is 'throw'
     * and a client send fails.
     */
    pushChunk(streamId: StreamId, chunk: AgentOSResponse): Promise<void>;
    /**
     * Closes a specific stream. All subscribed clients will be notified and subsequently deregistered.
     * No further data can be pushed to a closed stream.
     *
     * @public
     * @async
     * @param {StreamId} streamId - The ID of the stream to close.
     * @param {string} [reason] - An optional reason for closing the stream.
     * @returns {Promise<void>} A promise that resolves when the stream is closed and clients are notified.
     * @throws {StreamError} If the stream does not exist.
     */
    closeStream(streamId: StreamId, reason?: string): Promise<void>;
    /**
     * Handles an error that occurred on a specific stream.
     * This might involve notifying clients with an error chunk and/or closing the stream.
     *
     * @public
     * @async
     * @param {StreamId} streamId - The ID of the stream where the error occurred.
     * @param {Error} error - The error object.
     * @param {boolean} [terminateStream=true] - If true, the stream will be closed after processing the error.
     * @returns {Promise<void>} A promise that resolves when the error has been handled.
     * @throws {StreamError} If the stream does not exist.
     */
    handleStreamError(streamId: StreamId, error: Error, terminateStream?: boolean): Promise<void>;
    /**
     * Retrieves a list of IDs for all currently active streams.
     *
     * @public
     * @returns {Promise<StreamId[]>} A promise resolving to an array of active stream IDs.
     */
    getActiveStreamIds(): Promise<StreamId[]>;
    /**
     * Retrieves the number of clients currently subscribed to a specific stream.
     *
     * @public
     * @async
     * @param {StreamId} streamId - The ID of the stream.
     * @returns {Promise<number>} A promise resolving to the number of clients.
     * @throws {StreamError} If the stream does not exist.
     */
    getClientCountForStream(streamId: StreamId): Promise<number>;
    /**
     * Gracefully shuts down the StreamingManager, closing all active streams
     * and releasing any resources.
     *
     * @public
     * @async
     * @returns {Promise<void>} A promise that resolves when shutdown is complete.
     */
    shutdown(): Promise<void>;
}
/**
 * @class StreamingManager
 * @implements {IStreamingManager}
 * Manages real-time data streams for AgentOS, handling client subscriptions
 * and chunk distribution.
 */
export declare class StreamingManager implements IStreamingManager {
    private config;
    private activeStreams;
    private isInitialized;
    readonly managerId: string;
    constructor();
    /** @inheritdoc */
    initialize(config: StreamingManagerConfig): Promise<void>;
    /**
     * Ensures the manager has been properly initialized before any operations.
     * @private
     * @throws {StreamError} If the engine is not initialized.
     */
    private ensureInitialized;
    /** @inheritdoc */
    createStream(requestedStreamId?: StreamId): Promise<StreamId>;
    /** @inheritdoc */
    registerClient(streamId: StreamId, client: IStreamClient): Promise<void>;
    /** @inheritdoc */
    deregisterClient(streamId: StreamId, clientId: StreamClientId): Promise<void>;
    /** @inheritdoc */
    pushChunk(streamId: StreamId, chunk: AgentOSResponse): Promise<void>;
    /** @inheritdoc */
    closeStream(streamId: StreamId, reason?: string): Promise<void>;
    /** @inheritdoc */
    handleStreamError(streamId: StreamId, error: Error, terminateStream?: boolean): Promise<void>;
    /** @inheritdoc */
    getActiveStreamIds(): Promise<StreamId[]>;
    /** @inheritdoc */
    getClientCountForStream(streamId: StreamId): Promise<number>;
    /** @inheritdoc */
    shutdown(isReinitializing?: boolean): Promise<void>;
}
//# sourceMappingURL=StreamingManager.d.ts.map