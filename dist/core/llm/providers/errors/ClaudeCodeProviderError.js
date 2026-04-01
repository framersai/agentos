/**
 * @fileoverview Custom error class for Claude Code CLI provider errors.
 * Extends {@link CLISubprocessError} with Claude-specific error codes.
 *
 * @module agentos/core/llm/providers/errors/ClaudeCodeProviderError
 * @see {@link CLISubprocessError}
 */
import { CLISubprocessError } from '../../../../sandbox/subprocess/errors.js';
/**
 * Error specific to the Claude Code CLI provider.
 * Extends the generic {@link CLISubprocessError} with the `claude` binary name
 * and Claude-specific error codes.
 *
 * @example
 * throw new ClaudeCodeProviderError(
 *   'Claude Code CLI is not installed.',
 *   'BINARY_NOT_FOUND',
 *   'Install it: npm install -g @anthropic-ai/claude-code',
 *   false,
 * );
 */
export class ClaudeCodeProviderError extends CLISubprocessError {
    /**
     * @param message — human-readable error description
     * @param code — one of {@link ClaudeCodeErrorCode}
     * @param guidance — actionable fix instructions shown to the user
     * @param recoverable — true if AgentOS should attempt fallback (default false)
     * @param details — optional underlying error or extra context
     */
    constructor(message, code, guidance, recoverable = false, details) {
        super(message, code, 'claude', guidance, recoverable, details);
        this.name = 'ClaudeCodeProviderError';
        Object.setPrototypeOf(this, ClaudeCodeProviderError.prototype);
    }
}
//# sourceMappingURL=ClaudeCodeProviderError.js.map