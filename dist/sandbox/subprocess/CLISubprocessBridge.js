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
import { execa } from 'execa';
/** Default subprocess timeout (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120000;
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
export class CLISubprocessBridge {
    /* ---- Virtual: override if your CLI differs ---- */
    /**
     * Parse the JSON stdout from `--output-format json`.
     * Default implementation: JSON.parse with graceful fallback to raw text.
     * Override if your CLI's JSON output has a different shape.
     */
    parseJsonResult(stdout, durationMs) {
        try {
            const parsed = JSON.parse(stdout.trim());
            return {
                result: parsed.result ?? parsed.message ?? parsed.response ?? stdout.trim(),
                sessionId: parsed.session_id,
                usage: parsed.usage
                    ? { input_tokens: parsed.usage.input_tokens ?? 0, output_tokens: parsed.usage.output_tokens ?? 0 }
                    : undefined,
                isError: parsed.is_error === true,
                durationMs,
            };
        }
        catch {
            return { result: stdout.trim(), isError: false, durationMs };
        }
    }
    /**
     * Build args and stdin for the lightweight authentication check.
     * Override for CLI-specific flags (e.g. Claude needs --bare --max-turns 1).
     */
    buildAuthCheckArgs() {
        return {
            args: ['-p', '--output-format', 'json'],
            stdin: 'Reply with exactly: pong',
        };
    }
    /**
     * Parse a version string from the CLI's --version output.
     * Default: extracts first semver-like pattern (/\d+\.\d+\.\d+/).
     */
    parseVersion(stdout) {
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        return match ? match[1] : 'unknown';
    }
    /* ---- Concrete: shared lifecycle ---- */
    /**
     * Check if the binary is installed and on PATH.
     * Returns the resolved path and parsed version string if found.
     */
    async checkBinaryInstalled() {
        try {
            const whichResult = await execa('which', [this.binaryName]);
            const binaryPath = whichResult.stdout.trim();
            const versionResult = await execa(this.binaryName, ['--version']);
            const version = this.parseVersion(versionResult.stdout);
            return { installed: true, binaryPath, version };
        }
        catch {
            return { installed: false };
        }
    }
    /**
     * Check if the CLI is authenticated via a lightweight ping.
     * Uses {@link buildAuthCheckArgs} for CLI-specific flags.
     */
    async checkAuthenticated() {
        try {
            const { args, stdin } = this.buildAuthCheckArgs();
            await execa(this.binaryName, args, { input: stdin, timeout: 30000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Non-streaming execution.
     * Spawns the binary with `--output-format json`, pipes prompt via stdin,
     * and returns the parsed result.
     *
     * @param options — bridge options (prompt, system prompt, model, etc.)
     * @returns parsed result with text, session ID, usage, and timing
     * @throws {CLISubprocessError} on subprocess failure (via {@link classifyError})
     */
    async execute(options) {
        const args = this.buildArgs(options, 'json');
        const startMs = Date.now();
        try {
            const result = await execa(this.binaryName, args, {
                input: options.prompt,
                timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
                cancelSignal: options.abortSignal,
                ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
            });
            const durationMs = Date.now() - startMs;
            return this.parseJsonResult(result.stdout, durationMs);
        }
        catch (error) {
            throw this.classifyError(error);
        }
    }
    /**
     * Streaming execution.
     * Spawns the binary with `--output-format stream-json` and yields
     * {@link StreamEvent}s parsed from newline-delimited JSON on stdout.
     *
     * @param options — bridge options
     * @yields typed stream events (text_delta, result, error, system)
     * @throws {CLISubprocessError} on subprocess failure (via {@link classifyError})
     */
    async *stream(options) {
        const args = this.buildArgs(options, 'stream-json');
        let subprocess;
        try {
            subprocess = execa(this.binaryName, args, {
                input: options.prompt,
                timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
                cancelSignal: options.abortSignal,
                ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
            });
        }
        catch (error) {
            throw this.classifyError(error);
        }
        let buffer = '';
        try {
            for await (const chunk of subprocess.stdout) {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    try {
                        const event = this.parseStreamEvent(JSON.parse(trimmed));
                        if (event)
                            yield event;
                    }
                    catch {
                        /* skip unparseable lines (progress spinners, etc.) */
                    }
                }
            }
            /* flush remaining buffer */
            if (buffer.trim()) {
                try {
                    const event = this.parseStreamEvent(JSON.parse(buffer.trim()));
                    if (event)
                        yield event;
                }
                catch { /* ignore */ }
            }
            /* Ensure non-zero exits after stdout drains still surface as errors. */
            await subprocess;
        }
        catch (error) {
            throw this.classifyError(error);
        }
    }
}
//# sourceMappingURL=CLISubprocessBridge.js.map