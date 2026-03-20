/**
 * @file PiiRedactTool.ts
 * @description AgentOS tool that detects and redacts PII (Personally
 * Identifiable Information) from text, returning both the redacted output
 * and the detection metadata.
 *
 * This tool wraps both the {@link PiiDetectionPipeline} and the
 * {@link redactText} engine, providing a single-step "detect then redact"
 * operation.  Agents invoke it when they need sanitised text output, for
 * example before storing user-provided content in a database or forwarding
 * it to an external API.
 *
 * @module pii-redaction/tools/PiiRedactTool
 */

import type { ISharedServiceRegistry } from '../../../ISharedServiceRegistry';
import type {
  ITool,
  ToolExecutionContext,
  ToolExecutionResult,
  JSONSchemaObject,
} from '../../../../core/tools/ITool';
import type {
  PiiRedactionPackOptions,
  PiiDetectionResult,
  RedactionStyle,
} from '../types';
import { PiiDetectionPipeline } from '../PiiDetectionPipeline';
import { redactText } from '../RedactionEngine';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * Input arguments accepted by the {@link PiiRedactTool}.
 *
 * Only `text` is required.  The optional `redactionStyle` allows the caller
 * to override the pack-level default for this single invocation.
 */
export interface PiiRedactInput {
  /** The text from which PII should be redacted. */
  text: string;

  /**
   * Optional override for the redaction style.
   * When omitted the tool uses the pack-level redaction style configuration.
   */
  redactionStyle?: RedactionStyle;
}

/**
 * Output returned by the {@link PiiRedactTool} on successful execution.
 *
 * Contains both the redacted text and the full detection result so callers
 * can inspect what was found and how confident the detections were.
 */
export interface PiiRedactOutput {
  /** The text with all detected PII spans replaced. */
  redactedText: string;

  /** The original input text (for reference / diff comparison). */
  originalText: string;

  /**
   * Whether any PII was detected and redacted.
   * When `false`, `redactedText` is identical to `originalText`.
   */
  wasRedacted: boolean;

  /** Full detection result including entities, timing, and summary. */
  detectionResult: PiiDetectionResult;
}

// ---------------------------------------------------------------------------
// PiiRedactTool
// ---------------------------------------------------------------------------

/**
 * AgentOS tool that detects PII in text and returns a redacted version.
 *
 * ### Usage by agents
 * ```json
 * {
 *   "tool": "pii_redact",
 *   "arguments": {
 *     "text": "My SSN is 123-45-6789",
 *     "redactionStyle": "mask"
 *   }
 * }
 * ```
 *
 * ### Return value
 * A {@link PiiRedactOutput} containing the redacted text, the original text,
 * a boolean flag indicating whether any PII was found, and the full
 * {@link PiiDetectionResult} for audit / observability.
 *
 * @implements {ITool<PiiRedactInput, PiiRedactOutput>}
 */
export class PiiRedactTool implements ITool<PiiRedactInput, PiiRedactOutput> {
  // -----------------------------------------------------------------------
  // ITool metadata
  // -----------------------------------------------------------------------

  /** Globally unique identifier for the tool. */
  readonly id = 'pii_redact';

  /** Functional name used by LLMs in tool call requests. */
  readonly name = 'pii_redact';

  /** Human-readable display name for UIs and logs. */
  readonly displayName = 'PII Redactor';

  /** Detailed description for LLM tool selection. */
  readonly description =
    'Detect and redact Personally Identifiable Information (PII) from text. ' +
    'Returns both the redacted text and detection metadata including entity types, ' +
    'positions, and confidence scores. Use this to sanitise text before storing, ' +
    'logging, or forwarding it to external systems.';

  /** Tool category for filtering and grouping. */
  readonly category = 'security';

  /** This tool is read-only and has no side effects. */
  readonly hasSideEffects = false;

  /** JSON Schema describing the expected input arguments. */
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text from which PII should be redacted.',
      },
      redactionStyle: {
        type: 'string',
        enum: ['placeholder', 'mask', 'hash', 'category-tag'],
        description:
          'How detected PII should be replaced. Defaults to the pack-level setting ' +
          '(typically "placeholder"). Options: "placeholder" ([EMAIL]), "mask" (j***@*****), ' +
          '"hash" ([EMAIL:a1b2c3d4e5]), "category-tag" (<PII type="EMAIL">REDACTED</PII>).',
      },
    },
    required: ['text'],
  };

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** Detection pipeline instance shared across invocations. */
  private readonly pipeline: PiiDetectionPipeline;

  /** Default redaction style from pack-level configuration. */
  private readonly defaultRedactionStyle: RedactionStyle;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Construct a new PiiRedactTool.
   *
   * @param services - Shared service registry forwarded to the detection
   *                   pipeline for lazy-loading NLP/NER models.
   * @param options  - Pack-level configuration controlling entity types,
   *                   confidence threshold, redaction style, and detection
   *                   tier flags.
   */
  constructor(
    services: ISharedServiceRegistry,
    options: PiiRedactionPackOptions,
  ) {
    this.pipeline = new PiiDetectionPipeline(services, options);
    this.defaultRedactionStyle = options.redactionStyle ?? 'placeholder';
  }

  // -----------------------------------------------------------------------
  // ITool — execute
  // -----------------------------------------------------------------------

  /**
   * Execute the PII redaction on the provided text.
   *
   * Runs the full detection pipeline, then applies the configured (or
   * overridden) redaction style to all detected PII spans.  Returns both
   * the sanitised text and the raw detection result for audit purposes.
   *
   * @param args    - Input arguments containing the text to redact and an
   *                  optional redaction style override.
   * @param context - Tool execution context (unused by this tool but required
   *                  by the ITool interface).
   * @returns A promise resolving to the tool execution result containing the
   *          {@link PiiRedactOutput}.
   */
  async execute(
    args: PiiRedactInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<PiiRedactOutput>> {
    try {
      // Validate that the required `text` argument is present and non-empty.
      if (!args.text || typeof args.text !== 'string') {
        return {
          success: false,
          error: 'The "text" argument is required and must be a non-empty string.',
        };
      }

      // Run the detection pipeline.
      const detectionResult = await this.pipeline.detect(args.text);

      // Determine which redaction style to use (per-call override or default).
      const style = args.redactionStyle ?? this.defaultRedactionStyle;

      // Apply redaction to detected entity spans.
      const redacted = redactText(args.text, detectionResult.entities, style);

      // Build the output payload.
      const output: PiiRedactOutput = {
        redactedText: redacted,
        originalText: args.text,
        wasRedacted: detectionResult.entities.length > 0,
        detectionResult,
      };

      return {
        success: true,
        output,
      };
    } catch (error) {
      // Wrap unexpected errors in a failed ToolExecutionResult rather than
      // letting them propagate as unhandled exceptions.
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error during PII redaction';
      return {
        success: false,
        error: message,
        details: { stack: error instanceof Error ? error.stack : undefined },
      };
    }
  }
}
