/**
 * @fileoverview Custom error class for Gemini CLI provider errors.
 * Extends {@link CLISubprocessError} with Gemini-specific error codes.
 *
 * @module agentos/core/llm/providers/errors/GeminiCLIProviderError
 * @see {@link CLISubprocessError}
 */
import { CLISubprocessError } from '../../../../sandbox/subprocess/errors.js';
/**
 * Error specific to the Gemini CLI provider.
 *
 * @example
 * throw new GeminiCLIProviderError(
 *   'Gemini CLI is not installed.',
 *   'BINARY_NOT_FOUND',
 *   'Install it: npm install -g @google/gemini-cli',
 *   false,
 * );
 */
export class GeminiCLIProviderError extends CLISubprocessError {
    constructor(message, code, guidance, recoverable = false, details) {
        super(message, code, 'gemini', guidance, recoverable, details);
        this.name = 'GeminiCLIProviderError';
        Object.setPrototypeOf(this, GeminiCLIProviderError.prototype);
    }
}
//# sourceMappingURL=GeminiCLIProviderError.js.map