/**
 * @fileoverview Gemini CLI bridge — extends the generalized
 * {@link CLISubprocessBridge} with Gemini-specific flag assembly,
 * error classification, stream event parsing, and temp-file system prompts.
 *
 * Key differences from Claude Code:
 * - No `--system-prompt` flag → uses temp file + `GEMINI_SYSTEM_MD` env var
 * - No `--json-schema` flag → tool calling handled at provider level via XML prompts
 * - No `--bare` or `--max-turns` flags
 * - Uses `-p` (same as Claude's `-p`) and `--output-format json|stream-json`
 *
 * @module agentos/core/llm/providers/implementations/GeminiCLIBridge
 * @see CLISubprocessBridge
 * @see GeminiCLIProvider
 */
import { CLISubprocessBridge } from '../../../../sandbox/subprocess/CLISubprocessBridge';
import { GeminiCLIProviderError } from '../errors/GeminiCLIProviderError';
import type { BridgeOptions, BridgeResult, StreamEvent, OutputFormat } from '../../../../sandbox/subprocess/types';
export type { BridgeOptions, BridgeResult, StreamEvent } from '../../../../sandbox/subprocess/types';
export type { InstallCheckResult } from '../../../../sandbox/subprocess/types';
/**
 * Gemini CLI subprocess bridge.
 *
 * Extends {@link CLISubprocessBridge} to implement:
 * - Flag assembly: `-p`, `--output-format`, `-m`
 * - System prompt via temp file + `GEMINI_SYSTEM_MD` env var
 * - Error classification: auth, rate-limit, timeout, quota errors
 * - Stream event parsing: Gemini's stream-json format
 */
export declare class GeminiCLIBridge extends CLISubprocessBridge {
    protected readonly binaryName = "gemini";
    protected buildArgs(options: BridgeOptions, format: OutputFormat): string[];
    protected buildAuthCheckArgs(): {
        args: string[];
        stdin: string;
    };
    /**
     * Execute with a system prompt injected via a temporary file.
     * Writes the system prompt to a temp .md file, sets `GEMINI_SYSTEM_MD`
     * in the subprocess env, runs the command, and cleans up.
     *
     * @param options — bridge options (systemPrompt will be written to temp file)
     * @returns bridge result
     */
    executeWithSystemPrompt(options: BridgeOptions): Promise<BridgeResult>;
    /**
     * Stream with a system prompt injected via a temporary file.
     *
     * @param options — bridge options (systemPrompt will be written to temp file)
     * @yields stream events
     */
    streamWithSystemPrompt(options: BridgeOptions): AsyncGenerator<StreamEvent, void, undefined>;
    /**
     * Helper: write system prompt to temp file, run callback with env, clean up.
     */
    private withSystemPromptFile;
    protected parseStreamEvent(raw: any): StreamEvent | null;
    protected classifyError(error: any): GeminiCLIProviderError;
}
//# sourceMappingURL=GeminiCLIBridge.d.ts.map