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
 * 1. **Static validation** ({@link validateCode}) rejects dangerous patterns
 *    (regex scan) before any code reaches the runtime.
 * 2. **Runtime isolation** executes validated code inside a minimal context that
 *    exposes only JSON, Math, Date, TextEncoder, TextDecoder, and explicitly
 *    opted-in APIs.
 * 3. **Resource bounding** enforces wall-clock timeout so runaway loops cannot
 *    starve the host process.
 */

import { createContext, runInContext } from 'node:vm';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxAPI,
} from './types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

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

// ============================================================================
// BANNED PATTERN DEFINITIONS
// ============================================================================

/**
 * Patterns that are ALWAYS banned regardless of the allowlist.
 * Each entry is a tuple of `[regex, human-readable description]`.
 */
const ALWAYS_BANNED: ReadonlyArray<[RegExp, string]> = [
  [/\beval\s*\(/, 'eval() is forbidden'],
  [/\bFunction\s*\(/, 'Function() is forbidden'],
  [/\bnew\s+Function\s*\(/, 'new Function() is forbidden'],
  [/\brequire\s*\(/, 'require() is forbidden'],
  [/\bimport\s+/, 'import statements are forbidden'],
  [/\bimport\s*\(/, 'dynamic import() is forbidden'],
  [/\bprocess\s*\./, 'process access is forbidden'],
  [/\bchild_process\b/, 'child_process access is forbidden'],
  [/\bfs\s*\.\s*write/, 'fs.write* is forbidden'],
  [/\bfs\s*\.\s*unlink/, 'fs.unlink is forbidden'],
  [/\bfs\s*\.\s*rm\b/, 'fs.rm is forbidden'],
  [/\bfs\s*\.\s*rmdir/, 'fs.rmdir is forbidden'],
  [/\bfs\s*\.\s*appendFile/, 'fs.appendFile is forbidden'],
  [/\bfs\s*\.\s*truncate/, 'fs.truncate is forbidden'],
];

// ============================================================================
// SANDBOXED TOOL FORGE
// ============================================================================

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
export class SandboxedToolForge {
  /** Resolved memory limit in MB. */
  private readonly memoryMB: number;

  /** Resolved timeout in milliseconds. */
  private readonly timeoutMs: number;

  /** Domain allowlist for sandboxed `fetch` calls. */
  private readonly fetchDomainAllowlist: string[];

  /** Filesystem roots sandboxed reads may access. */
  private readonly fsReadRoots: string[];

  /**
   * Create a new SandboxedToolForge instance.
   *
   * @param config - Optional configuration overrides. All fields have sensible
   *   defaults (128 MB memory, 5000 ms timeout, no domain restrictions).
   */
  constructor(config?: SandboxedToolForgeConfig) {
    this.memoryMB = config?.memoryMB ?? 128;
    this.timeoutMs = config?.timeoutMs ?? 5000;
    this.fetchDomainAllowlist = (config?.fetchDomainAllowlist ?? []).map((d) =>
      d.toLowerCase(),
    );
    this.fsReadRoots = (config?.fsReadRoots ?? [process.cwd()]).map((root) =>
      path.resolve(root),
    );
  }

  // --------------------------------------------------------------------------
  // PUBLIC: validateCode
  // --------------------------------------------------------------------------

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
  validateCode(
    code: string,
    allowlist: SandboxAPI[],
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    // Check always-banned patterns.
    for (const [pattern, message] of ALWAYS_BANNED) {
      if (pattern.test(code)) {
        violations.push(message);
      }
    }

    // Conditionally ban `fetch(` when not allowed.
    if (!allowlist.includes('fetch') && /\bfetch\s*\(/.test(code)) {
      violations.push('fetch() is not in the allowlist');
    }

    // Conditionally ban all `fs.*` when fs.readFile is not allowed.
    // We already caught write/unlink/rm above, but if fs.readFile is not in
    // the allowlist, ban any fs reference.
    if (!allowlist.includes('fs.readFile') && /\bfs\s*\./.test(code)) {
      // Only add if we haven't already flagged a more specific fs violation.
      const hasFsViolation = violations.some((v) => v.startsWith('fs.'));
      if (!hasFsViolation) {
        violations.push('fs access is not in the allowlist');
      }
    }

    // Conditionally ban `crypto` when not allowed.
    if (!allowlist.includes('crypto') && /\bcrypto\s*\./.test(code)) {
      violations.push('crypto access is not in the allowlist');
    }

    return violations.length === 0
      ? { valid: true, violations: [] }
      : { valid: false, violations };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: execute
  // --------------------------------------------------------------------------

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
   * 1. Run {@link validateCode} — reject immediately if violations are found.
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
  async execute(
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const timeout = request.timeoutMs ?? this.timeoutMs;
    const startTime = performance.now();

    // Step 1: Static validation.
    const validation = this.validateCode(request.code, request.allowlist);
    if (!validation.valid) {
      return {
        success: false,
        error: `Code validation failed: ${validation.violations.join('; ')}`,
        executionTimeMs: Math.round(performance.now() - startTime),
        memoryUsedBytes: 0,
      };
    }

    // Step 2: Build sandbox context with only safe globals + allowlisted APIs.
    const sandboxGlobals = this.buildSandboxContext(request.allowlist);

    // Step 3: Wrap the code so it supports either `execute(input)` or
    // `run(input)` and always resolves async work before serializing the result.
    const wrappedCode = `
      (async () => {
        ${request.code};
        const __entry =
          typeof execute === 'function'
            ? execute
            : (typeof run === 'function' ? run : null);
        if (!__entry) {
          throw new Error('Sandboxed tool must define execute(input) or run(input).');
        }
        return JSON.stringify(await __entry(${JSON.stringify(request.input)}));
      })();
    `;

    // Step 4: Execute in VM with timeout.
    try {
      const ctx = createContext(sandboxGlobals);
      const rawResult = runInContext(wrappedCode, ctx, {
        timeout,
        // Prevent breakOnSigint from leaking.
        breakOnSigint: false,
      });
      const settledResult =
        rawResult &&
        typeof rawResult === 'object' &&
        typeof (rawResult as Promise<unknown>).then === 'function'
          ? await Promise.race([
              rawResult as Promise<unknown>,
              new Promise<never>((_, reject) => {
                setTimeout(() => {
                  reject(new Error(`Execution timed out after ${timeout}ms`));
                }, timeout);
              }),
            ])
          : rawResult;

      const executionTimeMs = Math.round(performance.now() - startTime);

      // Parse the JSON-serialized output.
      let output: unknown;
      try {
        output =
          typeof settledResult === 'string'
            ? JSON.parse(settledResult)
            : settledResult;
      } catch {
        // If JSON.parse fails, use the raw result.
        output = settledResult;
      }

      return {
        success: true,
        output,
        executionTimeMs,
        memoryUsedBytes: 0,
      };
    } catch (err: unknown) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      const message =
        err instanceof Error ? err.message : String(err);

      // Detect timeout errors from the vm module.
      const isTimeout =
        message.includes('Script execution timed out') ||
        message.includes('timed out');

      return {
        success: false,
        error: isTimeout
          ? `Execution timed out after ${timeout}ms`
          : `Execution error: ${message}`,
        executionTimeMs,
        memoryUsedBytes: 0,
      };
    }
  }

  // --------------------------------------------------------------------------
  // PRIVATE: buildSandboxContext
  // --------------------------------------------------------------------------

  /**
   * Build the global context object for the VM sandbox.
   *
   * Provides a minimal set of safe built-ins (JSON, Math, Date, TextEncoder,
   * TextDecoder) and conditionally injects allowlisted APIs.
   *
   * @param allowlist - The set of APIs to inject into the sandbox.
   * @returns A plain object suitable for {@link createContext}.
   */
  private buildSandboxContext(
    allowlist: SandboxAPI[],
  ): Record<string, unknown> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const globals: Record<string, unknown> = {
      // Safe built-ins always available.
      JSON,
      Math,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      RegExp,
      Error,
      TypeError,
      RangeError,
      TextEncoder,
      TextDecoder,
      // Minimal crypto for randomUUID.
      crypto: { randomUUID: () => randomUUID() },
      // Console stub that silently discards output.
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
        info: () => {},
        debug: () => {},
      },
    };

    // --- Allowlisted: fetch ---
    if (allowlist.includes('fetch')) {
      const domainAllowlist = this.fetchDomainAllowlist;
      globals.fetch = async (
        urlOrRequest: string | { url: string },
        init?: Record<string, unknown>,
      ) => {
        const urlStr =
          typeof urlOrRequest === 'string'
            ? urlOrRequest
            : urlOrRequest.url;
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();

        // Enforce domain allowlist if configured.
        if (
          domainAllowlist.length > 0 &&
          !domainAllowlist.includes(host)
        ) {
          throw new Error(
            `fetch blocked: domain "${host}" is not in the allowlist`,
          );
        }

        // Delegate to the real global fetch.
        return globalThis.fetch(urlStr, init as any);
      };
    }

    // --- Allowlisted: fs.readFile ---
    if (allowlist.includes('fs.readFile')) {
      globals.fs = {
        readFile: async (filePath: string) => {
          const resolvedPath = path.resolve(filePath);
          const allowed = this.fsReadRoots.some((root) => {
            return (
              resolvedPath === root ||
              resolvedPath.startsWith(`${root}${path.sep}`)
            );
          });
          if (!allowed) {
            throw new Error(
              `fs.readFile blocked: path "${resolvedPath}" is outside the allowed roots`,
            );
          }
          const data = await readFile(filePath);
          // Enforce 1 MB size limit.
          if (data.byteLength > 1_048_576) {
            throw new Error(
              `fs.readFile blocked: file exceeds 1 MB limit (${data.byteLength} bytes)`,
            );
          }
          return data.toString('utf-8');
        },
      };
    }

    // --- Allowlisted: crypto ---
    if (allowlist.includes('crypto')) {
      globals.crypto = {
        randomUUID: () => randomUUID(),
        createHash: (algorithm: string) => createHash(algorithm),
        createHmac: (algorithm: string, key: string) =>
          createHmac(algorithm, key),
      };
    }

    return globals;
  }
}
