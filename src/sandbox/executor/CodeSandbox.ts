/**
 * @file CodeSandbox.ts
 * @description Implementation of the Code Execution Sandbox.
 *
 * Provides isolated code execution with security controls.
 * Currently supports JavaScript execution in-process with sandboxing.
 * Python/Shell require external runtime configuration.
 *
 * @module AgentOS/Sandbox
 * @version 1.0.0
 */

import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../../logging/ILogger';
import {
  ICodeSandbox,
  SandboxLanguage,
  SandboxConfig,
  ExecutionRequest,
  ExecutionResult,
  SecurityEvent,
  SandboxStats,
  SandboxError,
} from './ICodeSandbox';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: SandboxConfig = {
  timeoutMs: 30000, // 30 seconds
  maxMemoryBytes: 128 * 1024 * 1024, // 128MB
  maxOutputBytes: 1024 * 1024, // 1MB
  allowNetwork: false,
  allowFilesystem: false,
  blockedModules: ['fs', 'child_process', 'cluster', 'dgram', 'dns', 'http', 'https', 'net', 'tls', 'vm'],
  maxCpuTimeMs: 10000, // 10 seconds
};

/** Dangerous patterns by language */
const DANGEROUS_PATTERNS: Record<SandboxLanguage, RegExp[]> = {
  javascript: [
    /require\s*\(\s*['"`](fs|child_process|cluster|net|dgram|dns|http|https|tls|os|process)['"`]\s*\)/gi,
    /import\s+.*\s+from\s+['"`](fs|child_process|cluster|net|dgram|dns|http|https|tls)['"`]/gi,
    /process\.(exit|kill|env|binding|dlopen)/gi,
    /eval\s*\(/gi,
    /Function\s*\(/gi,
    /new\s+Function/gi,
    /__proto__|__defineGetter__|__defineSetter__/gi,
    /constructor\s*\[\s*['"`]constructor['"`]\s*\]/gi,
  ],
  typescript: [
    /require\s*\(\s*['"`](fs|child_process|cluster|net|dgram|dns|http|https|tls|os|process)['"`]\s*\)/gi,
    /import\s+.*\s+from\s+['"`](fs|child_process|cluster|net|dgram|dns|http|https|tls)['"`]/gi,
    /process\.(exit|kill|env|binding|dlopen)/gi,
    /eval\s*\(/gi,
  ],
  python: [
    /import\s+(os|subprocess|sys|socket|shutil|glob|pathlib|ctypes)/gi,
    /from\s+(os|subprocess|sys|socket|shutil|glob|pathlib|ctypes)\s+import/gi,
    /__import__\s*\(/gi,
    /exec\s*\(/gi,
    /eval\s*\(/gi,
    /open\s*\(/gi,
    /compile\s*\(/gi,
  ],
  shell: [
    /rm\s+-rf?\s+\//gi,
    /dd\s+if=/gi,
    /mkfs/gi,
    /:(){ :|:& };:/gi, // Fork bomb
    />\s*\/dev\/sd[a-z]/gi,
    /curl|wget.*\|.*sh/gi,
  ],
  sql: [
    /DROP\s+(TABLE|DATABASE|SCHEMA)/gi,
    /TRUNCATE\s+TABLE/gi,
    /DELETE\s+FROM\s+\w+\s*;/gi, // DELETE without WHERE
    /UPDATE\s+\w+\s+SET.*;\s*$/gi, // UPDATE without WHERE
    /--\s*$|\/\*|\*\//gi, // SQL comments that could be injection
    /;\s*DROP|;\s*DELETE|;\s*UPDATE|;\s*INSERT/gi, // Chained statements
  ],
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Code Execution Sandbox implementation.
 *
 * Provides isolated code execution with security controls.
 */
export class CodeSandbox implements ICodeSandbox {
  private logger?: ILogger;
  private defaultConfig: SandboxConfig;
  private executions = new Map<string, ExecutionResult>();
  private runningExecutions = new Map<string, AbortController>();
  private stats: SandboxStats;

  constructor(defaultConfig?: Partial<SandboxConfig>) {
    this.defaultConfig = { ...DEFAULT_CONFIG, ...defaultConfig };
    this.stats = this.createEmptyStats();
  }

  /**
   * Initializes the sandbox.
   */
  public async initialize(logger?: ILogger, defaultConfig?: SandboxConfig): Promise<void> {
    this.logger = logger;
    if (defaultConfig) {
      this.defaultConfig = { ...this.defaultConfig, ...defaultConfig };
    }
    this.logger?.info?.('CodeSandbox initialized');
  }

  /**
   * Executes code in the sandbox.
   */
  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const executionId = request.executionId || uuidv4();
    const config = { ...this.defaultConfig, ...request.config };
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    this.stats.totalExecutions++;
    this.stats.byLanguage[request.language] = (this.stats.byLanguage[request.language] || 0) + 1;

    // Validate code for security issues
    const securityEvents = this.validateCode(request.language, request.code);
    const criticalEvents = securityEvents.filter(e => e.severity === 'critical' || e.severity === 'high');

    if (criticalEvents.length > 0) {
      this.stats.failedExecutions++;
      this.stats.securityEventsCount += criticalEvents.length;

      const result: ExecutionResult = {
        executionId,
        status: 'error',
        error: `Security violations detected: ${criticalEvents.map(e => e.description).join('; ')}`,
        durationMs: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
        securityEvents: criticalEvents,
      };
      this.executions.set(executionId, result);
      return result;
    }

    // Create abort controller for timeout
    const abortController = new AbortController();
    this.runningExecutions.set(executionId, abortController);

    // Set timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, config.timeoutMs || DEFAULT_CONFIG.timeoutMs!);

    try {
      let result: ExecutionResult;

      switch (request.language) {
        case 'javascript':
          result = await this.executeJavaScript(executionId, request, config, startedAt, startTime);
          break;
        case 'python':
          result = await this.executePython(executionId, request, config, startedAt, startTime);
          break;
        case 'shell':
          result = await this.executeShell(executionId, request, config, startedAt, startTime);
          break;
        default:
          throw new SandboxError(
            `Language "${request.language}" is not currently supported`,
            'error',
            executionId,
          );
      }

      // Update stats
      if (result.status === 'success') {
        this.stats.successfulExecutions++;
      } else if (result.status === 'timeout') {
        this.stats.timedOutExecutions++;
      } else if (result.status === 'killed') {
        this.stats.killedExecutions++;
      } else {
        this.stats.failedExecutions++;
      }

      // Update averages
      this.updateAverages(result);

      // Add any non-critical security events
      if (securityEvents.length > 0) {
        result.securityEvents = [...(result.securityEvents || []), ...securityEvents];
        this.stats.securityEventsCount += securityEvents.length;
      }

      this.executions.set(executionId, result);
      return result;
    } catch (error) {
      this.stats.failedExecutions++;
      const result: ExecutionResult = {
        executionId,
        status: abortController.signal.aborted ? 'timeout' : 'error',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      this.executions.set(executionId, result);
      return result;
    } finally {
      clearTimeout(timeoutId);
      this.runningExecutions.delete(executionId);
    }
  }

  /**
   * Executes JavaScript code in a sandboxed context.
   */
  private async executeJavaScript(
    executionId: string,
    request: ExecutionRequest,
    config: SandboxConfig,
    startedAt: string,
    startTime: number,
  ): Promise<ExecutionResult> {
    let stdout = '';
    let stderr = '';

    // Create sandboxed console
    const sandboxConsole = {
      log: (...args: unknown[]) => {
        stdout += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
      },
      error: (...args: unknown[]) => {
        stderr += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
      },
      warn: (...args: unknown[]) => {
        stderr += '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
      },
      info: (...args: unknown[]) => {
        stdout += '[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
      },
    };

    // Create safe globals
    const safeGlobals: Record<string, unknown> = {
      console: sandboxConsole,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      setTimeout: undefined, // Blocked
      setInterval: undefined, // Blocked
      fetch: undefined, // Blocked
      require: undefined, // Blocked
      import: undefined, // Blocked
      process: undefined, // Blocked
      global: undefined, // Blocked
      globalThis: undefined, // Blocked
    };

    try {
      // Create a function from the code
      const wrappedCode = `
        "use strict";
        return (async function(console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, WeakMap, WeakSet, Promise, parseInt, parseFloat, isNaN, isFinite, encodeURI, decodeURI, encodeURIComponent, decodeURIComponent) {
          ${request.code}
        })(${Object.keys(safeGlobals).map(k => k === 'console' ? 'arguments[0].console' : `arguments[0].${k}`).join(', ')});
      `;

      // Execute with timeout
      const result = await Promise.race([
        new Function(wrappedCode)(safeGlobals),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Execution timeout')), config.timeoutMs || 30000),
        ),
      ]);

      // Add result to stdout if there was a return value
      if (result !== undefined) {
        stdout += typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
      }

      // Truncate if needed
      const truncated: ExecutionResult['truncated'] = {};
      if (stdout.length > (config.maxOutputBytes || DEFAULT_CONFIG.maxOutputBytes!)) {
        stdout = stdout.slice(0, config.maxOutputBytes) + '\n[OUTPUT TRUNCATED]';
        truncated.stdout = true;
      }
      if (stderr.length > (config.maxOutputBytes || DEFAULT_CONFIG.maxOutputBytes!)) {
        stderr = stderr.slice(0, config.maxOutputBytes) + '\n[OUTPUT TRUNCATED]';
        truncated.stderr = true;
      }

      return {
        executionId,
        status: 'success',
        output: {
          stdout,
          stderr,
          exitCode: 0,
        },
        durationMs: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
        truncated: Object.keys(truncated).length > 0 ? truncated : undefined,
      };
    } catch (error) {
      stderr += error instanceof Error ? error.message : String(error);
      return {
        executionId,
        status: 'error',
        output: {
          stdout,
          stderr,
          exitCode: 1,
        },
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Executes Python code (placeholder - requires external runtime).
   */
  private async executePython(
    executionId: string,
    request: ExecutionRequest,
    config: SandboxConfig,
    startedAt: string,
    startTime: number,
  ): Promise<ExecutionResult> {
    // In a production environment, this would spawn a Python process
    // in a restricted container or use something like Pyodide (WebAssembly)
    this.logger?.warn?.('Python execution requires external runtime configuration');

    return {
      executionId,
      status: 'error',
      error: 'Python execution not available. Configure external Python runtime or use JavaScript.',
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Executes shell commands (placeholder - requires external runtime).
   */
  private async executeShell(
    executionId: string,
    request: ExecutionRequest,
    config: SandboxConfig,
    startedAt: string,
    startTime: number,
  ): Promise<ExecutionResult> {
    this.logger?.warn?.('Shell execution requires external runtime configuration');

    return {
      executionId,
      status: 'error',
      error: 'Shell execution not available in sandboxed environment.',
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Kills a running execution.
   */
  public async kill(executionId: string): Promise<boolean> {
    const controller = this.runningExecutions.get(executionId);
    if (controller) {
      controller.abort();
      const execution = this.executions.get(executionId);
      if (execution) {
        execution.status = 'killed';
        execution.completedAt = new Date().toISOString();
      }
      return true;
    }
    return false;
  }

  /**
   * Gets the status of an execution.
   */
  public async getExecution(executionId: string): Promise<ExecutionResult | undefined> {
    return this.executions.get(executionId);
  }

  /**
   * Lists recent executions.
   */
  public async listExecutions(limit = 50): Promise<ExecutionResult[]> {
    return Array.from(this.executions.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  /**
   * Checks if a language is supported.
   */
  public isLanguageSupported(language: string): boolean {
    return ['javascript', 'typescript', 'python', 'shell', 'sql'].includes(language.toLowerCase());
  }

  /**
   * Gets supported languages.
   */
  public getSupportedLanguages(): SandboxLanguage[] {
    return ['javascript', 'python', 'shell', 'sql'];
  }

  /**
   * Gets sandbox statistics.
   */
  public getStats(): SandboxStats {
    return { ...this.stats };
  }

  /**
   * Resets statistics.
   */
  public resetStats(): void {
    this.stats = this.createEmptyStats();
  }

  /**
   * Validates code for security issues.
   */
  public validateCode(language: SandboxLanguage, code: string): SecurityEvent[] {
    const events: SecurityEvent[] = [];
    const patterns = DANGEROUS_PATTERNS[language] || [];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        events.push({
          type: 'blocked_import',
          description: `Potentially dangerous pattern detected: ${matches[0]}`,
          timestamp: new Date().toISOString(),
          severity: this.getSeverityForPattern(pattern, language),
        });
      }
    }

    return events;
  }

  /**
   * Disposes of the sandbox.
   */
  public async dispose(): Promise<void> {
    // Kill all running executions
    for (const [id, controller] of this.runningExecutions) {
      controller.abort();
      this.logger?.info?.(`Killed execution ${id} during disposal`);
    }
    this.runningExecutions.clear();
    this.executions.clear();
    this.logger?.info?.('CodeSandbox disposed');
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private createEmptyStats(): SandboxStats {
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      timedOutExecutions: 0,
      killedExecutions: 0,
      avgDurationMs: 0,
      avgMemoryBytes: 0,
      byLanguage: {} as Record<SandboxLanguage, number>,
      securityEventsCount: 0,
    };
  }

  private updateAverages(result: ExecutionResult): void {
    const total = this.stats.totalExecutions;
    this.stats.avgDurationMs =
      (this.stats.avgDurationMs * (total - 1) + result.durationMs) / total;

    if (result.memoryUsedBytes) {
      this.stats.avgMemoryBytes =
        (this.stats.avgMemoryBytes * (total - 1) + result.memoryUsedBytes) / total;
    }
  }

  private getSeverityForPattern(pattern: RegExp, _language: SandboxLanguage): SecurityEvent['severity'] {
    const source = pattern.source.toLowerCase();

    // Critical patterns - check first as they're most dangerous
    if (
      source.includes('rm\\s+-rf') ||
      source.includes('dd\\s+if=') ||
      source.includes('mkfs') ||
      source.includes('fork bomb') ||
      source.includes(':\\(\\)') ||
      source.includes('/dev/sd')
    ) {
      return 'critical';
    }

    // High severity patterns
    if (
      source.includes('child_process') ||
      source.includes('subprocess') ||
      source.includes('exec\\s*\\(') ||
      source.includes('eval\\s*\\(') ||
      source.includes('drop\\s+') ||
      source.includes('delete\\s+from') ||
      source.includes('truncate')
    ) {
      return 'high';
    }

    // Medium severity patterns
    if (
      source.includes('fs') ||
      source.includes('net') ||
      source.includes('http') ||
      source.includes('os') ||
      source.includes('process') ||
      source.includes('socket') ||
      source.includes('import\\s+os')
    ) {
      return 'medium';
    }

    return 'low';
  }
}

