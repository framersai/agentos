/**
 * @fileoverview Abstract base class for CLI subprocess bridges.
 * Uses the template method pattern: owns subprocess lifecycle (spawn, pipe,
 * parse NDJSON, timeout/abort) while subclasses implement CLI-specific
 * flag assembly, error classification, and stream event parsing.
 *
 * This is a first-class AgentOS core capability — any provider, extension,
 * tool, or skill can extend this to manage external CLI binaries.
 *
 * @module agentos/sandbox/subprocess/CLISubprocessBridge
 * @see ClaudeCodeCLIBridge
 */
import { CLISubprocessError } from './errors';
import type { BridgeOptions, BridgeResult, StreamEvent, OutputFormat, InstallCheckResult } from './types';
/**
 * Abstract base class for managing CLI subprocesses via execa.
 *
 * Subclasses implement four methods:
 * - {@link binaryName} — the CLI binary on PATH
 * - {@link buildArgs} — CLI-specific flag assembly
 * - {@link classifyError} — error classification with guidance
 * - {@link parseStreamEvent} — stream-json event parsing
 *
 * The base class handles:
 * - Binary installation detection (`which` + version parsing)
 * - Authentication health checks
 * - Non-streaming execution with JSON result parsing
 * - Streaming execution with NDJSON line splitting
 * - Timeout and abort signal management
 *
 * @example
 * class MyToolBridge extends CLISubprocessBridge {
 *   protected readonly binaryName = 'mytool';
 *   protected buildArgs(opts, fmt) { return ['-p', '--format', fmt]; }
 *   protected classifyError(err) { return new CLISubprocessError(...); }
 *   protected parseStreamEvent(raw) { return { type: 'text_delta', text: raw.text }; }
 * }
 */
export declare abstract class CLISubprocessBridge {
    /** The CLI binary name on PATH (e.g. 'claude', 'gemini', 'ffmpeg'). */
    protected abstract readonly binaryName: string;
    /**
     * Build the CLI argument array for a given call.
     * Called by {@link execute} and {@link stream} with the appropriate output format.
     *
     * @param options — caller-provided bridge options
     * @param format — 'json' for execute(), 'stream-json' for stream()
     * @returns array of CLI arguments
     */
    protected abstract buildArgs(options: BridgeOptions, format: OutputFormat): string[];
    /**
     * Classify a subprocess error into a typed {@link CLISubprocessError}.
     * Examines stderr, exit code, error.code to produce actionable guidance.
     *
     * @param error — the raw error from execa
     * @returns a CLISubprocessError (or subclass) with guidance and recoverability
     */
    protected abstract classifyError(error: any): CLISubprocessError;
    /**
     * Parse a raw JSON object from stream-json output into a typed {@link StreamEvent}.
     * Returns null for events that should be skipped (progress spinners, etc.).
     *
     * @param raw — a parsed JSON object from one line of NDJSON stdout
     * @returns a typed StreamEvent, or null to skip
     */
    protected abstract parseStreamEvent(raw: any): StreamEvent | null;
    /**
     * Parse the JSON stdout from `--output-format json`.
     * Default implementation: JSON.parse with graceful fallback to raw text.
     * Override if your CLI's JSON output has a different shape.
     */
    protected parseJsonResult(stdout: string, durationMs: number): BridgeResult;
    /**
     * Build args and stdin for the lightweight authentication check.
     * Override for CLI-specific flags (e.g. Claude needs --bare --max-turns 1).
     */
    protected buildAuthCheckArgs(): {
        args: string[];
        stdin: string;
    };
    /**
     * Parse a version string from the CLI's --version output.
     * Default: extracts first semver-like pattern (/\d+\.\d+\.\d+/).
     */
    protected parseVersion(stdout: string): string;
    /**
     * Check if the binary is installed and on PATH.
     * Returns the resolved path and parsed version string if found.
     */
    checkBinaryInstalled(): Promise<InstallCheckResult>;
    /**
     * Check if the CLI is authenticated via a lightweight ping.
     * Uses {@link buildAuthCheckArgs} for CLI-specific flags.
     */
    checkAuthenticated(): Promise<boolean>;
    /**
     * Non-streaming execution.
     * Spawns the binary with `--output-format json`, pipes prompt via stdin,
     * and returns the parsed result.
     *
     * @param options — bridge options (prompt, system prompt, model, etc.)
     * @returns parsed result with text, session ID, usage, and timing
     * @throws {CLISubprocessError} on subprocess failure (via {@link classifyError})
     */
    execute(options: BridgeOptions): Promise<BridgeResult>;
    /**
     * Streaming execution.
     * Spawns the binary with `--output-format stream-json` and yields
     * {@link StreamEvent}s parsed from newline-delimited JSON on stdout.
     *
     * @param options — bridge options
     * @yields typed stream events (text_delta, result, error, system)
     * @throws {CLISubprocessError} on subprocess failure (via {@link classifyError})
     */
    stream(options: BridgeOptions): AsyncGenerator<StreamEvent, void, undefined>;
}
//# sourceMappingURL=CLISubprocessBridge.d.ts.map