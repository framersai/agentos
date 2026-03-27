/**
 * @fileoverview Base error class for CLI subprocess operations.
 * Fully generic — works for any binary (LLM CLIs, dev tools, media tools, etc.).
 * Error codes are open strings so each consumer can define their own.
 *
 * @module agentos/core/subprocess/errors
 */

/**
 * Base error for ANY CLI subprocess managed by {@link CLISubprocessBridge}.
 * Not specific to LLM CLIs — works for ffmpeg, git, docker, or any binary.
 *
 * Carries actionable {@link guidance} so the user knows how to fix the problem,
 * and a {@link recoverable} flag so callers know whether to retry or fall back.
 *
 * @example
 * throw new CLISubprocessError(
 *   'ffmpeg not found.',
 *   CLI_ERROR.BINARY_NOT_FOUND,
 *   'ffmpeg',
 *   'Install ffmpeg: brew install ffmpeg',
 *   false,
 * );
 */
export class CLISubprocessError extends Error {
  /** Error code — open string, not a fixed union. Each CLI defines its own. */
  public readonly code: string;

  /** The binary that failed (e.g. 'claude', 'gemini', 'ffmpeg'). */
  public readonly binaryName: string;

  /** Human-readable fix instructions shown to the user. */
  public readonly guidance: string;

  /** Whether the caller can retry or fall back. */
  public readonly recoverable: boolean;

  /** Optional underlying error or extra context. */
  public readonly details?: unknown;

  /**
   * @param message — human-readable error description
   * @param code — error code string (use {@link CLI_ERROR} constants or your own)
   * @param binaryName — the CLI binary that failed
   * @param guidance — actionable fix instructions shown to the user
   * @param recoverable — true if the caller should attempt retry/fallback (default false)
   * @param details — optional underlying error or extra context
   */
  constructor(
    message: string,
    code: string,
    binaryName: string,
    guidance: string,
    recoverable: boolean = false,
    details?: unknown,
  ) {
    super(message);
    this.name = 'CLISubprocessError';
    this.code = code;
    this.binaryName = binaryName;
    this.guidance = guidance;
    this.recoverable = recoverable;
    this.details = details;

    Object.setPrototypeOf(this, CLISubprocessError.prototype);
  }
}

/**
 * Common error code constants shared across many CLIs.
 * Consumers can use these or define their own — these are suggestions, not constraints.
 *
 * @example
 * // Use a common code
 * new CLISubprocessError('Not found', CLI_ERROR.BINARY_NOT_FOUND, 'claude', '...');
 *
 * // Use a custom code
 * new CLISubprocessError('Codec missing', 'CODEC_NOT_FOUND', 'ffmpeg', '...');
 */
export const CLI_ERROR = {
  /** Binary not found on PATH. */
  BINARY_NOT_FOUND: 'BINARY_NOT_FOUND',
  /** Binary installed but not authenticated / logged in. */
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  /** Binary version too old for required features. */
  VERSION_OUTDATED: 'VERSION_OUTDATED',
  /** Process failed to start (permissions, missing deps, etc.). */
  SPAWN_FAILED: 'SPAWN_FAILED',
  /** Process exceeded timeout. */
  TIMEOUT: 'TIMEOUT',
  /** Process exited with non-zero exit code. */
  CRASHED: 'CRASHED',
  /** Rate limit / quota exceeded. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Permission denied (EACCES). */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /** Input/context too long for the CLI to handle. */
  CONTEXT_TOO_LONG: 'CONTEXT_TOO_LONG',
} as const;
