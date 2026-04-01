/**
 * @fileoverview Claude Code CLI bridge — extends the generalized
 * {@link CLISubprocessBridge} with Claude-specific flag assembly,
 * error classification, and stream event parsing.
 *
 * This class only contains what's specific to the `claude` binary.
 * All subprocess lifecycle (spawn, pipe, NDJSON parse, timeout) is
 * handled by the base class.
 *
 * @module agentos/core/llm/providers/implementations/ClaudeCodeCLIBridge
 * @see CLISubprocessBridge
 * @see ClaudeCodeProvider
 */
import { CLISubprocessBridge } from '../../../../sandbox/subprocess/CLISubprocessBridge';
import { ClaudeCodeProviderError } from '../errors/ClaudeCodeProviderError';
import type { BridgeOptions, StreamEvent, OutputFormat } from '../../../../sandbox/subprocess/types';
export type { BridgeOptions as CLIBridgeOptions, BridgeResult as CLIBridgeResult, StreamEvent } from '../../../../sandbox/subprocess/types';
export type { InstallCheckResult } from '../../../../sandbox/subprocess/types';
/**
 * Claude Code CLI subprocess bridge.
 *
 * Extends {@link CLISubprocessBridge} to implement:
 * - Flag assembly: `--bare`, `-p`, `--system-prompt`, `--json-schema`, `--max-turns`
 * - Error classification: auth, rate-limit, timeout, ENOENT, EACCES, context length
 * - Stream event parsing: `content_block_delta`, `result`, `error`, `system` events
 * - Auth check: uses `--bare --max-turns 1` for lightweight health ping
 */
export declare class ClaudeCodeCLIBridge extends CLISubprocessBridge {
    protected readonly binaryName = "claude";
    protected buildArgs(options: BridgeOptions, format: OutputFormat): string[];
    protected buildAuthCheckArgs(): {
        args: string[];
        stdin: string;
    };
    protected parseStreamEvent(raw: any): StreamEvent | null;
    protected classifyError(error: any): ClaudeCodeProviderError;
}
//# sourceMappingURL=ClaudeCodeCLIBridge.d.ts.map