/**
 * @file CodeSandbox.ts
 * @description Implementation of the Code Execution Sandbox.
 *
 * Provides isolated code execution with security controls:
 * - JavaScript: runs in-process via node:vm with context isolation,
 *   codeGeneration restrictions (eval/Function/WASM blocked), and
 *   frozen safe globals.
 * - Python: spawns a `python3` subprocess via execa with optional
 *   security preambles that monkey-patch filesystem and network access.
 * - Shell: spawns bash (or cmd on Windows) via execa with configurable
 *   network/filesystem restrictions.
 *
 * @module AgentOS/Sandbox
 * @version 2.0.0
 */
import type { ILogger } from '../../logging/ILogger';
import { ICodeSandbox, SandboxLanguage, SandboxConfig, ExecutionRequest, ExecutionResult, SecurityEvent, SandboxStats } from './ICodeSandbox';
/**
 * Code Execution Sandbox implementation.
 *
 * Provides isolated code execution with security controls.
 */
export declare class CodeSandbox implements ICodeSandbox {
    private logger?;
    private defaultConfig;
    private executions;
    private runningExecutions;
    private stats;
    constructor(defaultConfig?: Partial<SandboxConfig>);
    /**
     * Initializes the sandbox.
     */
    initialize(logger?: ILogger, defaultConfig?: SandboxConfig): Promise<void>;
    /**
     * Executes code in the sandbox.
     */
    execute(request: ExecutionRequest): Promise<ExecutionResult>;
    /**
     * Executes JavaScript code in a hardened VM sandbox using node:vm.
     *
     * Security guarantees:
     * - Isolated context prevents access to host globals (process, require, etc.)
     * - `codeGeneration.strings = false` blocks eval() and new Function() inside the sandbox
     * - `codeGeneration.wasm = false` blocks WebAssembly compilation
     * - Frozen console object prevents prototype chain manipulation
     * - Explicit undefined assignments for dangerous globals (process, global, globalThis)
     */
    private executeJavaScript;
    /**
     * Executes Python code by spawning a `python3` subprocess via execa.
     *
     * Security:
     * - When `config.allowNetwork` is false, a preamble is prepended that
     *   poisons network-related modules (socket, urllib, requests, aiohttp, etc.)
     *   so imports raise an error.
     * - When `config.allowFilesystem` is false, a preamble monkey-patches
     *   builtins.open to raise PermissionError and blocks os/shutil/pathlib.
     * - Code is written to a temp file, executed, and the temp file is
     *   unconditionally cleaned up in a finally block.
     */
    private executePython;
    /**
     * Executes shell commands by spawning bash (or cmd on Windows) via execa.
     *
     * Security:
     * - When `config.allowNetwork` is false, http_proxy and https_proxy
     *   environment variables are set to invalid addresses to block most
     *   HTTP-based network access.
     * - Timeout, cwd, and envVars from config are forwarded to the subprocess.
     * - Dangerous pattern validation (rm -rf /, fork bombs, etc.) is handled
     *   by `validateCode` before this method is called.
     */
    private executeShell;
    /**
     * Kills a running execution.
     */
    kill(executionId: string): Promise<boolean>;
    /**
     * Gets the status of an execution.
     */
    getExecution(executionId: string): Promise<ExecutionResult | undefined>;
    /**
     * Lists recent executions.
     */
    listExecutions(limit?: number): Promise<ExecutionResult[]>;
    /**
     * Checks if a language is supported.
     */
    isLanguageSupported(language: string): boolean;
    /**
     * Gets supported languages.
     */
    getSupportedLanguages(): SandboxLanguage[];
    /**
     * Gets sandbox statistics.
     */
    getStats(): SandboxStats;
    /**
     * Resets statistics.
     */
    resetStats(): void;
    /**
     * Validates code for security issues.
     */
    validateCode(language: SandboxLanguage, code: string): SecurityEvent[];
    /**
     * Disposes of the sandbox.
     */
    dispose(): Promise<void>;
    private createEmptyStats;
    private updateAverages;
    private getSeverityForPattern;
}
//# sourceMappingURL=CodeSandbox.d.ts.map