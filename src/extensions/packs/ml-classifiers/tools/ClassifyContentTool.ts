/**
 * @fileoverview On-demand content classification tool for AgentOS.
 *
 * `ClassifyContentTool` exposes the ML classifier pipeline as an invocable
 * {@link ITool}, enabling agents and workflows to explicitly classify text
 * for safety signals (toxicity, prompt injection, jailbreak) on demand,
 * rather than relying solely on the implicit guardrail pipeline.
 *
 * Use cases:
 * - An agent that needs to evaluate user-generated content before storing
 *   it in a knowledge base.
 * - A moderation workflow that classifies a batch of flagged messages.
 * - A debugging tool for inspecting classifier behaviour on specific inputs.
 *
 * The tool delegates to a {@link ClassifierOrchestrator} instance and returns
 * the full {@link ChunkEvaluation} (including per-classifier scores and the
 * aggregated recommended action).
 *
 * @module agentos/extensions/packs/ml-classifiers/tools/ClassifyContentTool
 */

import type {
  ITool,
  JSONSchemaObject,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../../../../core/tools/ITool';
import type { ChunkEvaluation } from '../types';
import type { ClassifierOrchestrator } from '../ClassifierOrchestrator';

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * Input arguments for the `classify_content` tool.
 */
export interface ClassifyInput {
  /**
   * The text to classify for safety signals.
   * Must not be empty.
   */
  text: string;

  /**
   * Optional subset of classifier IDs to run.
   * When omitted, all registered classifiers are invoked.
   */
  classifiers?: string[];
}

// ---------------------------------------------------------------------------
// ClassifyContentTool
// ---------------------------------------------------------------------------

/**
 * ITool implementation that runs ML content classifiers on demand.
 *
 * The tool is read-only (`hasSideEffects: false`) — it inspects text and
 * returns structured classification results without modifying any state.
 *
 * @implements {ITool<ClassifyInput, ChunkEvaluation>}
 *
 * @example
 * ```typescript
 * const tool = new ClassifyContentTool(orchestrator);
 * const result = await tool.execute(
 *   { text: 'some potentially harmful text' },
 *   executionContext,
 * );
 *
 * if (result.success) {
 *   console.log(result.output.recommendedAction); // 'allow' | 'flag' | 'block' | …
 * }
 * ```
 */
export class ClassifyContentTool implements ITool<ClassifyInput, ChunkEvaluation> {
  // -------------------------------------------------------------------------
  // ITool identity & metadata
  // -------------------------------------------------------------------------

  /** Unique tool identifier used for registration and lookup. */
  readonly id = 'classify_content';

  /** Functional name exposed to LLMs for tool-call invocation. */
  readonly name = 'classify_content';

  /** Human-readable display name for dashboards and UI. */
  readonly displayName = 'Content Safety Classifier';

  /** Natural-language description of the tool's purpose and behaviour. */
  readonly description =
    'Classify text for toxicity, prompt injection, and jailbreak attempts ' +
    'using ML models. Returns per-classifier scores and an aggregated ' +
    'recommended guardrail action.';

  /** Logical grouping for tool discovery and filtering. */
  readonly category = 'security';

  /** SemVer version of this tool implementation. */
  readonly version = '1.0.0';

  /** This tool only reads text — it performs no mutations. */
  readonly hasSideEffects = false;

  // -------------------------------------------------------------------------
  // JSON Schema for input validation
  // -------------------------------------------------------------------------

  /**
   * JSON Schema describing the expected input arguments.
   *
   * - `text` (required): The string to classify.
   * - `classifiers` (optional): Array of classifier IDs to restrict evaluation.
   */
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to classify for safety signals.',
      },
      classifiers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: only run these classifier IDs. When omitted all registered classifiers are used.',
      },
    },
    required: ['text'],
  };

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** The orchestrator that drives the underlying ML classifiers. */
  private readonly orchestrator: ClassifierOrchestrator;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a new ClassifyContentTool.
   *
   * @param orchestrator - The classifier orchestrator that will handle
   *                       parallel classification and result aggregation.
   */
  constructor(orchestrator: ClassifierOrchestrator) {
    this.orchestrator = orchestrator;
  }

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  /**
   * Run all (or a subset of) ML classifiers against the provided text and
   * return the aggregated evaluation.
   *
   * @param args    - Tool input containing the text to classify and an
   *                  optional list of classifier IDs to restrict execution.
   * @param _context - Execution context (unused — classification is
   *                   stateless and user-agnostic).
   * @returns A successful result containing the {@link ChunkEvaluation},
   *          or a failure result if the text is missing or classification
   *          throws an unexpected error.
   */
  async execute(
    args: ClassifyInput,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<ChunkEvaluation>> {
    // Validate that text is provided and non-empty.
    if (!args.text || args.text.trim().length === 0) {
      return {
        success: false,
        error: 'The "text" argument is required and must not be empty.',
      };
    }

    try {
      // Delegate to the orchestrator for parallel classification.
      // NOTE: The `args.classifiers` filter is not yet implemented in the
      // orchestrator — it would require a filtering layer.  For now, all
      // registered classifiers are invoked regardless.
      const evaluation = await this.orchestrator.classifyAll(args.text);

      return {
        success: true,
        output: evaluation,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Classification failed: ${message}`,
      };
    }
  }
}
