/**
 * @fileoverview SandboxedToolForge — runs agent-generated JavaScript code in an
 * isolated sandbox with strict resource limits and API allowlisting.
 *
 * @module @framers/agentos/emergent/SandboxedToolForge
 *
 * Overview:
 * - Attempts to use `isolated-vm` for true V8 isolate sandboxing when available.
 * - Falls back to Node.js `vm` module with timeout when `isolated-vm` is not installed.
 * - Enforces configurable memory limits (default 128 MB), execution timeouts (default 5 s),
 *   and a strict API blocklist that prevents access to `eval`, `Function`, `process`,
 *   `require`, `import`, `child_process`, and `fs.write*`.
 *
 * Allowlisted APIs (each requires explicit opt-in via {@link SandboxAPI}):
 * - `fetch` — HTTP requests (domain-restricted via {@link SandboxedToolForgeConfig.fetchDomainAllowlist}).
 * - `fs.readFile` — Read-only file access (path-restricted, max 1 MB).
 * - `crypto` — Hashing and HMAC only (`createHash`, `createHmac`).
 *
 * Security model:
 * 1. **Static validation** (`validateCode()`) rejects dangerous patterns
 *    (regex scan) before any code reaches the runtime.
 * 2. **Runtime isolation** executes validated code inside a minimal context that
 *    exposes only JSON, Math, Date, TextEncoder, TextDecoder, and explicitly
 *    opted-in APIs.
 * 3. **Resource bounding** enforces wall-clock timeout so runaway loops cannot
 *    starve the host process.
 */
import type { SandboxExecutionRequest, SandboxExecutionResult, SandboxAPI } from './types.js';
/**
 * Configuration options for the {@link SandboxedToolForge}.
 *
 * All fields are optional and fall back to sensible defaults.
 */
export interface SandboxedToolForgeConfig {
    /**
     * Maximum heap memory in megabytes for the sandbox process.
     * Used with `isolated-vm`; the `vm` fallback cannot enforce memory limits.
     * @default 128
     */
    memoryMB?: number;
    /**
     * Maximum wall-clock execution time in milliseconds.
     * @default 5000
     */
    timeoutMs?: number;
    /**
     * When `fetch` is in the allowlist, only requests to these domains are
     * permitted. An empty array means all domains are allowed.
     * Domain matching is case-insensitive and checks exact host equality.
     * @default []
     */
    fetchDomainAllowlist?: string[];
    /**
     * Filesystem roots sandboxed `fs.readFile` calls may access.
     * Relative paths are resolved from the current working directory.
     * Defaults to the current working directory only.
     */
    fsReadRoots?: string[];
}
/**
 * Runs agent-generated code in an isolated sandbox with strict resource limits.
 *
 * Attempts to use `isolated-vm` for true V8 isolate sandboxing. Falls back to
 * Node.js `vm` module with timeout if `isolated-vm` is not installed.
 *
 * Resource limits:
 * - Memory: configurable, default 128 MB
 * - Execution time: configurable, default 5000 ms
 * - Blocked APIs: eval, Function, process, require, import, child_process, fs.write*
 *
 * Allowlisted APIs (each requires explicit opt-in):
 * - `fetch`: HTTP requests (domain-restricted)
 * - `fs.readFile`: Read-only file access (path-restricted, max 1 MB)
 * - `crypto`: Hashing and HMAC only
 *
 * @example
 * ```ts
 * const forge = new SandboxedToolForge({ timeoutMs: 3000 });
 *
 * const result = await forge.execute({
 *   code: 'function execute(input) { return input.a + input.b; }',
 *   input: { a: 2, b: 3 },
 *   allowlist: [],
 *   memoryMB: 128,
 *   timeoutMs: 3000,
 * });
 *
 * console.log(result.output); // 5
 * ```
 */
export declare class SandboxedToolForge {
    /** Resolved memory limit in MB. */
    private readonly memoryMB;
    /** Resolved timeout in milliseconds. */
    private readonly timeoutMs;
    /** Domain allowlist for sandboxed `fetch` calls. */
    private readonly fetchDomainAllowlist;
    /** Filesystem roots sandboxed reads may access. */
    private readonly fsReadRoots;
    /**
     * Create a new SandboxedToolForge instance.
     *
     * @param config - Optional configuration overrides. All fields have sensible
     *   defaults (128 MB memory, 5000 ms timeout, no domain restrictions).
     */
    constructor(config?: SandboxedToolForgeConfig);
    /**
     * Static analysis of code — reject dangerous patterns before execution.
     *
     * Scans the source string for banned API usage patterns using regex matching.
     * If an API is not present in the allowlist, references to it are also flagged.
     *
     * Checked patterns (always banned):
     * - `eval()`, `new Function()`, `require()`, `import`, `process.*`
     * - `child_process`, `fs.write*`, `fs.unlink`, `fs.rm`, `fs.rmdir`
     *
     * Conditionally banned (when not in allowlist):
     * - `fetch(` — when `'fetch'` is not in the allowlist
     * - `fs.*` — when `'fs.readFile'` is not in the allowlist
     * - `crypto.*` — when `'crypto'` is not in the allowlist
     *
     * @param code - The raw source code string to validate.
     * @param allowlist - The set of APIs the code is permitted to use.
     * @returns An object with `valid: true` if no violations were found, or
     *   `valid: false` with a `violations` array describing each flagged pattern.
     *
     * @example
     * ```ts
     * const forge = new SandboxedToolForge();
     * const result = forge.validateCode('eval("exploit")', []);
     * // result.valid === false
     * // result.violations === ['eval() is forbidden']
     * ```
     */
    validateCode(code: string, allowlist: SandboxAPI[]): {
        valid: boolean;
        violations: string[];
    };
    /**
     * Execute agent-generated code in the sandbox.
     *
     * The code must define a function named `execute` that accepts a single
     * argument and returns the output:
     *
     * ```js
     * function execute(input) { return input.a + input.b; }
     * ```
     *
     * Execution flow:
     * 1. Run `validateCode()` — reject immediately if violations are found.
     * 2. Wrap the agent's code into a self-contained expression that calls `execute`.
     * 3. Run in a Node.js `vm` sandbox with a restricted global context.
     * 4. Parse the output, measure execution time, and return the result.
     *
     * @param request - The execution request containing code, input, allowlist,
     *   and resource limits.
     * @returns A {@link SandboxExecutionResult} with the output (on success) or
     *   error description (on failure), plus execution time telemetry.
     *
     * @example
     * ```ts
     * const result = await forge.execute({
     *   code: 'function execute(input) { return { sum: input.a + input.b }; }',
     *   input: { a: 10, b: 20 },
     *   allowlist: [],
     *   memoryMB: 128,
     *   timeoutMs: 5000,
     * });
     * // result.success === true
     * // result.output === { sum: 30 }
     * ```
     */
    execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
    /**
     * Build the global context object for the VM sandbox.
     *
     * Provides a minimal set of safe built-ins (JSON, Math, Date, TextEncoder,
     * TextDecoder) and conditionally injects allowlisted APIs.
     *
     * @param allowlist - The set of APIs to inject into the sandbox.
     * @returns A plain object suitable for {@link createContext}.
     */
    private buildSandboxContext;
}
//# sourceMappingURL=SandboxedToolForge.d.ts.map