/**
 * @file CodeSafetyGuardrail.ts
 * @description Guardrail implementation for the code safety scanner extension pack.
 *
 * ## Overview
 *
 * {@link CodeSafetyGuardrail} integrates with the AgentOS guardrail pipeline and
 * intercepts both user input and agent output to scan for security vulnerabilities
 * in code blocks before they reach the user or trigger tool execution.
 *
 * ### Two evaluation paths:
 *
 * **evaluateOutput** — intercepts streaming TEXT_DELTA chunks and TOOL_CALL_REQUEST
 * chunks emitted by the agent:
 * - For TEXT_DELTA: buffers per-stream text until a complete code fence is seen
 *   (opening + closing triple-backtick), then scans the buffered fence.
 * - For TOOL_CALL_REQUEST: extracts the code argument from each dangerous tool call
 *   (shell_execute, run_sql, etc.) and scans it directly.
 * - For final chunks (`isFinal === true`): flushes any buffered content and scans
 *   any remaining complete fences.
 *
 * **evaluateInput** — scans user-provided text for embedded code fences that contain
 * known-dangerous patterns, before orchestration begins.
 *
 * ### Action mapping:
 * - Violations with action `'block'` at severity critical/high → {@link GuardrailAction.BLOCK}
 *   with reasonCode `CODE_SAFETY_CRITICAL` or `CODE_SAFETY_HIGH`.
 * - Violations with action `'flag'` at severity medium/low → {@link GuardrailAction.FLAG}
 *   with reasonCode `CODE_SAFETY_MEDIUM` or `CODE_SAFETY_LOW`.
 * - No violations → `null` (allow).
 *
 * ### Stream buffering:
 *
 * Because code fences may span multiple TEXT_DELTA chunks the guardrail maintains
 * a per-stream {@link FenceState} buffer keyed by `streamId`.  Buffers are pruned
 * lazily when the map exceeds 100 entries to bound memory usage.
 *
 * @module code-safety/CodeSafetyGuardrail
 */

import type {
  IGuardrailService,
  GuardrailConfig,
  GuardrailInputPayload,
  GuardrailOutputPayload,
  GuardrailEvaluationResult,
} from '../../../core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../api/types/AgentOSResponse';
import type { CodeSafetyPackOptions, CodeSafetyViolation } from './types';
import {
  DEFAULT_CODE_EXECUTING_TOOLS,
  DEFAULT_CODE_ARGUMENT_MAPPING,
} from './types';
import type { CodeSafetyScanner } from './CodeSafetyScanner';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Per-stream mutable state used to buffer streaming TEXT_DELTA chunks until
 * a complete code fence (opening + closing triple-backtick) has been received.
 *
 * Maintained in a `Map<streamId, FenceState>` on the guardrail instance.
 */
interface FenceState {
  /**
   * Accumulated TEXT_DELTA text for this stream since the last flush.
   * Reset to `''` each time a complete fence is successfully scanned.
   */
  buffer: string;

  /**
   * Whether the current buffer has seen an opening ``` fence and is
   * now accumulating code inside it (awaiting the closing fence).
   *
   * Used as a hint to avoid scanning plain text that contains no fences.
   */
  inFence: boolean;

  /**
   * Unix timestamp (ms) of the most recent TEXT_DELTA chunk for this stream.
   * Used by the lazy pruning logic to detect abandoned/stale streams.
   */
  lastSeenAt: number;
}

/**
 * Maximum number of concurrent per-stream buffers before stale entries are
 * pruned.  Prevents unbounded memory growth in high-concurrency scenarios.
 */
const MAX_STREAM_BUFFERS = 100;

/**
 * Age (ms) beyond which a stream buffer is considered stale and eligible for
 * pruning.  10 minutes is a generous upper bound for any realistic response.
 */
const STALE_STREAM_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// CodeSafetyGuardrail
// ---------------------------------------------------------------------------

/**
 * AgentOS guardrail that scans agent output and user input for security
 * vulnerabilities in code blocks using {@link CodeSafetyScanner}.
 *
 * ### Usage
 *
 * ```ts
 * const scanner = new CodeSafetyScanner();
 * const guardrail = new CodeSafetyGuardrail({}, scanner);
 *
 * // Register with AgentOS:
 * agentOS.registerGuardrail(guardrail);
 * ```
 *
 * ### Configuration
 *
 * The guardrail always enables `evaluateStreamingChunks` so it receives every
 * TEXT_DELTA chunk in real time.  It never sanitizes content (`canSanitize: false`)
 * — it only blocks or flags.
 *
 * @implements {IGuardrailService}
 */
export class CodeSafetyGuardrail implements IGuardrailService {
  // -----------------------------------------------------------------------
  // IGuardrailService.config
  // -----------------------------------------------------------------------

  /**
   * Guardrail configuration.
   *
   * - `evaluateStreamingChunks: true` — required so we receive TEXT_DELTA chunks
   *   during streaming.  Without this the guardrail would only see final chunks,
   *   missing intermediate code fences.
   * - `canSanitize: false` — this guardrail does not modify content; it only
   *   BLOCKs or FLAGs.  Setting false puts it in Phase 2 (parallel) of the
   *   dispatcher which is more performant for read-only guardrails.
   */
  readonly config: GuardrailConfig = {
    evaluateStreamingChunks: true,
    canSanitize: false,
  };

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /**
   * Effective list of tool names whose arguments should be scanned.
   * Resolved from {@link CodeSafetyPackOptions.codeExecutingTools} with a
   * fallback to the pack-level default.
   */
  private readonly codeExecutingTools: Set<string>;

  /**
   * Effective argument mapping for code-executing tools.
   * Maps `toolName → { argKey, language }`.
   */
  private readonly codeArgumentMapping: Record<
    string,
    { argKey: string; language: string | null }
  >;

  /**
   * Per-stream fence-state buffers.
   *
   * Key: `streamId` string from the response chunk.
   * Value: {@link FenceState} describing accumulated text and fence state.
   *
   * Entries are created lazily on first TEXT_DELTA for a stream and pruned
   * lazily when the map exceeds {@link MAX_STREAM_BUFFERS}.
   */
  private readonly streamBuffers: Map<string, FenceState> = new Map();

  /**
   * The {@link CodeSafetyScanner} instance used for all scanning operations.
   * Stateless and safe to share.
   */
  private readonly scanner: CodeSafetyScanner;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new CodeSafetyGuardrail.
   *
   * @param options - Pack-level configuration options.  Used to resolve which
   *                  tools are monitored and how their arguments are extracted.
   * @param scanner - Configured {@link CodeSafetyScanner} instance to delegate
   *                  all rule-matching to.
   *
   * @example
   * ```ts
   * import { CodeSafetyScanner } from './CodeSafetyScanner';
   * import { CodeSafetyGuardrail } from './CodeSafetyGuardrail';
   *
   * const scanner = new CodeSafetyScanner();
   * const guardrail = new CodeSafetyGuardrail({ guardrailScope: 'output' }, scanner);
   * ```
   */
  constructor(options: CodeSafetyPackOptions, scanner: CodeSafetyScanner) {
    this.scanner = scanner;

    // Resolve the set of tool names to monitor from options (or use defaults).
    this.codeExecutingTools = new Set(
      options.codeExecutingTools ?? DEFAULT_CODE_EXECUTING_TOOLS,
    );

    this.codeArgumentMapping =
      options.codeArgumentMapping ?? DEFAULT_CODE_ARGUMENT_MAPPING;
  }

  // -----------------------------------------------------------------------
  // IGuardrailService — evaluateOutput
  // -----------------------------------------------------------------------

  /**
   * Evaluate an agent output chunk for code safety violations.
   *
   * Returns `null` (allow) when:
   * - The payload scope is `'input'` (output guardrail should not evaluate input).
   * - The chunk type is not TEXT_DELTA or TOOL_CALL_REQUEST (we have nothing to scan).
   * - No code violations are found.
   *
   * Returns a {@link GuardrailEvaluationResult} with BLOCK or FLAG action when
   * dangerous patterns are detected.
   *
   * ### TEXT_DELTA handling:
   *
   * Chunks are accumulated in a per-stream buffer.  The buffer is scanned only
   * when it contains **both** an opening and closing triple-backtick fence,
   * i.e. when `buffer.includes('```')` appears at least twice.  This ensures
   * we never scan a partial fence (which would produce false negatives on code
   * that is split across chunks).
   *
   * ### TOOL_CALL_REQUEST handling:
   *
   * Each `toolCall` in the chunk is checked against {@link codeExecutingTools}.
   * If the tool is listed, its code argument is extracted using
   * {@link codeArgumentMapping} and scanned directly with
   * {@link CodeSafetyScanner.scanCode}.
   *
   * @param payload - Output evaluation payload from the AgentOS dispatcher.
   * @returns Guardrail result or `null` if no action is required.
   */
  async evaluateOutput(
    payload: GuardrailOutputPayload,
  ): Promise<GuardrailEvaluationResult | null> {
    const { chunk } = payload;

    // The output guardrail should never be called for input scope, but guard
    // defensively in case the dispatcher routes incorrectly.
    // (The spec says: "If scope is 'input', return null" — the payload does
    // not actually carry a 'scope' field; this is inferred from which method is
    // called.  We keep the guard for belt-and-suspenders safety.)

    const chunkType = chunk.type;
    const streamId: string = (chunk as any).streamId ?? 'default';

    // -----------------------------------------------------------------------
    // TOOL_CALL_REQUEST — scan code arguments before tool execution
    // -----------------------------------------------------------------------
    if (chunkType === AgentOSResponseChunkType.TOOL_CALL_REQUEST) {
      const toolCalls: Array<{ name: string; arguments: Record<string, any> }> =
        (chunk as any).toolCalls ?? [];

      const allViolations: CodeSafetyViolation[] = [];

      for (const call of toolCalls) {
        // Only scan tools that are in the monitored set.
        if (!this.codeExecutingTools.has(call.name)) {
          continue;
        }

        // Look up which argument holds the code for this tool.
        const mapping = this.codeArgumentMapping[call.name];
        if (!mapping) {
          // No mapping configured — skip.
          continue;
        }

        const code: unknown = (call.arguments ?? {})[mapping.argKey];
        if (typeof code !== 'string' || code.length === 0) {
          // Argument is missing or not a string — nothing to scan.
          continue;
        }

        // Scan the raw code string with the language hint from the mapping.
        const violations = this.scanner.scanCode(code, mapping.language);
        allViolations.push(...violations);
      }

      return this.buildResult(allViolations);
    }

    // -----------------------------------------------------------------------
    // TEXT_DELTA — buffer text and scan complete fences
    // -----------------------------------------------------------------------
    if (chunkType === AgentOSResponseChunkType.TEXT_DELTA) {
      const textDelta: string = (chunk as any).textDelta ?? '';
      const isFinal: boolean = (chunk as any).isFinal ?? false;

      // Get-or-create the fence buffer for this stream.
      let state = this.streamBuffers.get(streamId);
      if (!state) {
        // Lazy pruning before inserting a new entry.
        if (this.streamBuffers.size >= MAX_STREAM_BUFFERS) {
          this.pruneStaleBuffers();
        }
        state = { buffer: '', inFence: false, lastSeenAt: Date.now() };
        this.streamBuffers.set(streamId, state);
      }

      // Append the new chunk to the accumulated buffer.
      state.buffer += textDelta;
      state.lastSeenAt = Date.now();

      // Track whether we are now inside a fence opening.
      // A simple way: count occurrences of ``` in the buffer so far.
      const backtickCount = (state.buffer.match(/```/g) ?? []).length;

      // Update the inFence flag: odd count = inside a fence, even = not inside.
      state.inFence = backtickCount % 2 === 1;

      // Only scan when the buffer contains at least one COMPLETE fence
      // (i.e. we have seen both an opening ``` and a closing ```).
      // A complete fence requires ≥ 2 occurrences of ```.
      const hasCompleteFence = backtickCount >= 2;

      if (hasCompleteFence || isFinal) {
        // Scan the entire buffer content.
        const result = this.scanner.scan(state.buffer);

        if (isFinal) {
          // Flush: remove the stream buffer entirely on final chunk.
          this.streamBuffers.delete(streamId);
        } else {
          // Partial flush: keep only text after the last complete closing fence
          // to handle the case where more fences may follow in subsequent chunks.
          const lastFenceEnd = this.findLastCompleteFenceEnd(state.buffer);
          if (lastFenceEnd !== -1) {
            // Retain only the text after the last complete fence.
            state.buffer = state.buffer.slice(lastFenceEnd);
          }
          // If we couldn't locate the fence end, keep the whole buffer.
          // inFence has already been updated above.
        }

        return this.buildResult(result.violations);
      }

      // Buffer accumulation only — no complete fence yet.
      return null;
    }

    // -----------------------------------------------------------------------
    // isFinal on any other chunk type — flush the stream buffer if it exists.
    // -----------------------------------------------------------------------
    if ((chunk as any).isFinal === true) {
      const state = this.streamBuffers.get(streamId);
      if (state && state.buffer.length > 0) {
        const result = this.scanner.scan(state.buffer);
        this.streamBuffers.delete(streamId);
        return this.buildResult(result.violations);
      }
    }

    // Unknown or unhandled chunk type — allow.
    return null;
  }

  // -----------------------------------------------------------------------
  // IGuardrailService — evaluateInput
  // -----------------------------------------------------------------------

  /**
   * Evaluate user input for code safety violations before orchestration.
   *
   * Scans the full `textInput` string using {@link CodeSafetyScanner.scan},
   * which extracts and evaluates any Markdown code fences present in the text.
   *
   * Returns `null` when:
   * - `textInput` is `null` or empty.
   * - No code violations are found.
   *
   * @param payload - Input evaluation payload containing the user's message.
   * @returns Guardrail result or `null` if no action is required.
   */
  async evaluateInput(
    payload: GuardrailInputPayload,
  ): Promise<GuardrailEvaluationResult | null> {
    const text = payload.input.textInput;

    // Nothing to scan if no text was provided.
    if (!text || text.length === 0) {
      return null;
    }

    const result = this.scanner.scan(text);
    return this.buildResult(result.violations);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Convert a list of {@link CodeSafetyViolation}s into a
   * {@link GuardrailEvaluationResult}, or return `null` when the list is empty.
   *
   * ### Priority logic:
   * 1. If ANY violation has action `'block'`, return BLOCK with the reasonCode
   *    derived from the highest-severity blocking violation.
   * 2. If ALL violations are `'flag'`, return FLAG with the reasonCode derived
   *    from the highest-severity flagging violation.
   * 3. If no violations, return `null`.
   *
   * @param violations - Array of violations from the scanner.
   * @returns Evaluation result or `null`.
   *
   * @internal
   */
  private buildResult(
    violations: CodeSafetyViolation[],
  ): GuardrailEvaluationResult | null {
    if (violations.length === 0) {
      return null;
    }

    // Separate into blocking and flagging violations.
    const blockers = violations.filter((v) => v.action === 'block');
    const flaggers = violations.filter((v) => v.action === 'flag');

    if (blockers.length > 0) {
      // Use the severity of the worst blocking violation as the reason code.
      const worst = this.worstSeverity(blockers);
      const reasonCode =
        worst === 'critical' ? 'CODE_SAFETY_CRITICAL' : 'CODE_SAFETY_HIGH';

      return {
        action: GuardrailAction.BLOCK,
        reason: `Code safety violation(s) detected: ${blockers.map((v) => v.ruleName).join(', ')}`,
        reasonCode,
        metadata: {
          violations: blockers.map((v) => ({
            ruleId: v.ruleId,
            severity: v.severity,
            category: v.category,
            matchedText: v.matchedText,
          })),
        },
      };
    }

    // Only flagging violations — allow but record.
    const worst = this.worstSeverity(flaggers);
    const reasonCode =
      worst === 'medium' ? 'CODE_SAFETY_MEDIUM' : 'CODE_SAFETY_LOW';

    return {
      action: GuardrailAction.FLAG,
      reason: `Code safety advisory: ${flaggers.map((v) => v.ruleName).join(', ')}`,
      reasonCode,
      metadata: {
        violations: flaggers.map((v) => ({
          ruleId: v.ruleId,
          severity: v.severity,
          category: v.category,
          matchedText: v.matchedText,
        })),
      },
    };
  }

  /**
   * Determine the worst (highest) severity among a non-empty list of violations.
   *
   * Severity order (worst to best): critical → high → medium → low.
   *
   * @param violations - Non-empty array of violations.
   * @returns The worst severity string found.
   *
   * @internal
   */
  private worstSeverity(
    violations: CodeSafetyViolation[],
  ): 'critical' | 'high' | 'medium' | 'low' {
    const order: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    let worst = violations[0].severity;
    for (const v of violations) {
      if ((order[v.severity] ?? 99) < (order[worst] ?? 99)) {
        worst = v.severity;
      }
    }
    return worst as 'critical' | 'high' | 'medium' | 'low';
  }

  /**
   * Find the character offset just past the last complete code fence closing
   * delimiter in `text`.
   *
   * A complete fence consists of:
   * ```
   * ```[lang]\n
   * ...code...
   * ```
   * ```
   *
   * We look for the last occurrence of a closing ``` (at the start of a line)
   * and return the index immediately after it (plus any trailing newline).
   *
   * Returns `-1` if no complete fence closing is found.
   *
   * @param text - Buffered stream text.
   * @returns Character offset just past the last closing fence, or -1.
   *
   * @internal
   */
  private findLastCompleteFenceEnd(text: string): number {
    // Match all closing fence delimiters (``` at start of line or preceded by newline).
    const closingFenceRe = /^```\s*$/gm;

    let lastEnd = -1;
    let match: RegExpExecArray | null;

    while ((match = closingFenceRe.exec(text)) !== null) {
      // Record position just after the closing backticks.
      lastEnd = match.index + match[0].length;
    }

    return lastEnd;
  }

  /**
   * Lazily prune stale stream buffers from {@link streamBuffers}.
   *
   * A buffer is considered stale when it has not received a chunk within the
   * last {@link STALE_STREAM_THRESHOLD_MS} milliseconds.  This prevents memory
   * leaks from streams that were abandoned (e.g. the client disconnected) before
   * the final chunk was delivered.
   *
   * Called automatically when the map size exceeds {@link MAX_STREAM_BUFFERS}.
   *
   * @internal
   */
  private pruneStaleBuffers(): void {
    const now = Date.now();
    for (const [id, state] of this.streamBuffers) {
      if (now - state.lastSeenAt > STALE_STREAM_THRESHOLD_MS) {
        this.streamBuffers.delete(id);
      }
    }
  }
}
