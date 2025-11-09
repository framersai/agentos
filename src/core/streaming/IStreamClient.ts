// File: src/core/streaming/IStreamClient.ts
/**
 * @fileoverview Defines the IStreamClient interface.
 * This interface represents the contract for any client that wishes to subscribe to
 * and receive data chunks from a stream managed by the StreamingManager.
 * Implementations of this interface will handle the actual transport of data
 * to the connected client (e.g., via WebSockets, SSE, etc.).
 *
 * @module backend/core/streaming/IStreamClient
 */

import { AgentOSResponse } from '../../api/types/AgentOSResponse';

/**
 * Represents a unique identifier for a stream client.
 * This could be a WebSocket connection ID, a unique user session sub-ID, etc.
 * @typedef {string} StreamClientId
 */
export type StreamClientId = string;

/**
 * @interface IStreamClient
 * @description Defines the essential methods that a stream client implementation
 * must provide to interact with the StreamingManager.
 */
export interface IStreamClient {
  /**
   * A unique identifier for this specific client instance.
   * @readonly
   * @type {StreamClientId}
   */
  readonly id: StreamClientId;

  /**
   * Sends a data chunk to the connected client.
   * This method should handle the specifics of the underlying transport protocol.
   *
   * @public
   * @async
   * @param {AgentOSResponse} chunk - The data chunk to send to the client.
   * @returns {Promise<void>} A promise that resolves when the chunk has been successfully
   * sent (or queued for sending), or rejects if an error occurs during sending.
   * @throws {Error} If sending the chunk fails due to a transport-level issue
   * (e.g., connection closed, buffer full).
   */
  sendChunk(chunk: AgentOSResponse): Promise<void>;

  /**
   * Notifies the client that the stream has been closed.
   * This could be due to normal completion, an error, or explicit closure by the system.
   *
   * @public
   * @async
   * @param {string} [reason] - An optional reason for the stream closure.
   * This might be a human-readable message or an error code.
   * @returns {Promise<void>} A promise that resolves when the closure notification
   * has been sent, or rejects if an error occurs.
   */
  notifyStreamClosed(reason?: string): Promise<void>;

  /**
   * Checks if the client connection is currently active and able to receive data.
   *
   * @public
   * @returns {boolean} True if the client is active, false otherwise.
   */
  isActive(): boolean;

  /**
   * Optional method to gracefully close the client's connection or clean up resources
   * from the client's perspective, possibly initiated by the StreamingManager.
   *
   * @public
   * @async
   * @param {string} [reason] - An optional reason for closing the client.
   * @returns {Promise<void>} A promise that resolves when the client has been closed.
   */
  close?(reason?: string): Promise<void>;
}