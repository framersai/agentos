/**
 * @file PiiScanTool.ts
 * @description AgentOS tool that scans text for PII (Personally Identifiable
 * Information) without modifying it.
 *
 * The tool wraps the {@link PiiDetectionPipeline} and exposes it as an
 * {@link ITool} so agents can programmatically inspect text for sensitive
 * data before deciding how to handle it (e.g., before logging, forwarding,
 * or storing user-provided content).
 *
 * Unlike the guardrail (which intercepts I/O automatically), this tool is
 * invoked explicitly by the agent or orchestrator when scan-only semantics
 * are needed.
 *
 * @module pii-redaction/tools/PiiScanTool
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
  PiiEntityType,
} from '../types';
import { PiiDetectionPipeline } from '../PiiDetectionPipeline';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Input arguments accepted by the {@link PiiScanTool}.
 *
 * Only `text` is required.  The optional `entityTypes` array allows the
 * caller to narrow detection to a subset of PII categories, overriding the
 * pack-level default for this single invocation.
 */
export interface PiiScanInput {
  /** The text to scan for PII entities. */
  text: string;

  /**
   * Optional subset of PII entity types to scan for.
   * When omitted the tool uses the pack-level entity type configuration.
   */
  entityTypes?: PiiEntityType[];
}

// ---------------------------------------------------------------------------
// PiiScanTool
// ---------------------------------------------------------------------------

/**
 * AgentOS tool that detects PII entities in text and returns structured
 * detection results without modifying the original text.
 *
 * ### Usage by agents
 * ```json
 * {
 *   "tool": "pii_scan",
 *   "arguments": {
 *     "text": "Contact John Smith at john@example.com"
 *   }
 * }
 * ```
 *
 * ### Return value
 * A {@link PiiDetectionResult} containing the list of detected entities,
 * processing metadata, and a human-readable summary.
 *
 * @implements {ITool<PiiScanInput, PiiDetectionResult>}
 */
export class PiiScanTool implements ITool<PiiScanInput, PiiDetectionResult> {
  // -----------------------------------------------------------------------
  // ITool metadata
  // -----------------------------------------------------------------------

  /** Globally unique identifier for the tool. */
  readonly id = 'pii_scan';

  /** Functional name used by LLMs in tool call requests. */
  readonly name = 'pii_scan';

  /** Human-readable display name for UIs and logs. */
  readonly displayName = 'PII Scanner';

  /** Detailed description for LLM tool selection. */
  readonly description =
    'Scan text for Personally Identifiable Information (PII) without modifying it. ' +
    'Returns a structured result listing all detected PII entities with their types, ' +
    'positions, confidence scores, and detection sources. Useful for auditing or ' +
    'deciding how to handle sensitive data before logging, forwarding, or storing it.';

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
        description: 'The text to scan for PII entities.',
      },
      entityTypes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional subset of PII entity types to scan for (e.g., ["EMAIL", "PHONE"]). ' +
          'When omitted, all configured entity types are scanned.',
      },
    },
    required: ['text'],
  };

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** Detection pipeline instance shared across invocations. */
  private readonly pipeline: PiiDetectionPipeline;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Construct a new PiiScanTool.
   *
   * @param services - Shared service registry forwarded to the detection
   *                   pipeline for lazy-loading NLP/NER models.
   * @param options  - Pack-level configuration controlling entity types,
   *                   confidence threshold, and detection tier flags.
   */
  constructor(
    services: ISharedServiceRegistry,
    options: PiiRedactionPackOptions,
  ) {
    this.pipeline = new PiiDetectionPipeline(services, options);
  }

  // -----------------------------------------------------------------------
  // ITool — execute
  // -----------------------------------------------------------------------

  /**
   * Execute the PII scan on the provided text.
   *
   * Runs the full detection pipeline (Regex -> NLP pre-filter -> NER -> LLM
   * judge, as configured) and returns the detection result wrapped in a
   * {@link ToolExecutionResult}.
   *
   * @param args    - Input arguments containing the text to scan and optional
   *                  entity type filter.
   * @param context - Tool execution context (unused by this tool but required
   *                  by the ITool interface).
   * @returns A promise resolving to the tool execution result containing the
   *          {@link PiiDetectionResult}.
   */
  async execute(
    args: PiiScanInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<PiiDetectionResult>> {
    try {
      // Validate that the required `text` argument is present and non-empty.
      if (!args.text || typeof args.text !== 'string') {
        return {
          success: false,
          error: 'The "text" argument is required and must be a non-empty string.',
        };
      }

      // Run the detection pipeline.
      const result = await this.pipeline.detect(args.text);

      // If the caller provided a subset of entity types, filter the results
      // to only include entities matching those types.
      if (args.entityTypes && args.entityTypes.length > 0) {
        const allowedTypes = new Set(args.entityTypes);
        const filteredEntities = result.entities.filter((e) =>
          allowedTypes.has(e.entityType),
        );

        return {
          success: true,
          output: {
            ...result,
            entities: filteredEntities,
            // Update summary to reflect the filtered count.
            summary:
              filteredEntities.length === 0
                ? 'No PII detected (after entity type filter)'
                : `${filteredEntities.length} ${filteredEntities.length === 1 ? 'entity' : 'entities'} found (filtered by type)`,
          },
        };
      }

      return {
        success: true,
        output: result,
      };
    } catch (error) {
      // Wrap unexpected errors in a failed ToolExecutionResult rather than
      // letting them propagate as unhandled exceptions.
      const message =
        error instanceof Error ? error.message : 'Unknown error during PII scan';
      return {
        success: false,
        error: message,
        details: { stack: error instanceof Error ? error.stack : undefined },
      };
    }
  }
}
