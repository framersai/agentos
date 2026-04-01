// File: backend/agentos/core/llm/providers/errors/ProviderError.ts
/**
 * @fileoverview Defines the base error class for AI Model Provider related errors.
 * This class provides a common structure for errors originating from provider interactions,
 * allowing for consistent error handling and identification across different provider implementations.
 * @module backend/agentos/core/llm/providers/errors/ProviderError
 */
/**
 * Represents a generic error that occurred within an AI Model Provider.
 * Specific provider implementations should extend this class to provide
 * more detailed error information.
 */
export class ProviderError extends Error {
    /**
     * Creates an instance of ProviderError.
     * @param {string} message - A human-readable description of the error.
     * @param {string} code - A unique code identifying the type of error.
     * @param {string} [providerId] - The identifier of the provider where the error originated.
     * @param {unknown} [details] - Optional details or context about the error.
     */
    constructor(message, code, providerId, details) {
        super(message);
        this.name = this.constructor.name; // Ensures the name property is the subclass name
        this.code = code;
        this.providerId = providerId;
        this.details = details;
        // This line is to make the stack trace more readable and skip the ProviderError constructor
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, this.constructor);
        }
        else {
            this.stack = new Error(message).stack;
        }
    }
}
//# sourceMappingURL=ProviderError.js.map