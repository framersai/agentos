/**
 * @module guardrailDispatcher
 *
 * Dispatches guardrail evaluations for input and output processing.
 *
 * This module provides two main functions:
 * - {@link evaluateInputGuardrails} - Evaluate user input before orchestration
 * - {@link wrapOutputGuardrails} - Wrap output stream with guardrail filtering
 *
 * @example
 * ```typescript
 * // Input evaluation
 * const outcome = await evaluateInputGuardrails(
 *   guardrailServices,
 *   userInput,
 *   guardrailContext
 * );
 *
 * if (outcome.evaluation?.action === GuardrailAction.BLOCK) {
 *   return createGuardrailBlockedStream(context, outcome.evaluation);
 * }
 *
 * // Output wrapping
 * const safeStream = wrapOutputGuardrails(
 *   guardrailServices,
 *   guardrailContext,
 *   outputStream,
 *   { streamId, personaId }
 * );
 * ```
 */
import { uuidv4 } from '@framers/agentos/utils/uuid';
import type { AgentOSInput } from '../../api/types/AgentOSInput';
import {
  AgentOSResponse,
  AgentOSResponseChunkType,
  type AgentOSErrorChunk,
  type AgentOSFinalResponseChunk,
} from '../../api/types/AgentOSResponse';
import {
  GuardrailAction,
  type GuardrailContext,
  type GuardrailEvaluationResult,
  type IGuardrailService,
} from './IGuardrailService';

/**
 * Type guard to check if a guardrail service implements evaluateOutput.
 * @internal
 */
function hasEvaluateOutput(
  svc: IGuardrailService,
): svc is IGuardrailService & {
  evaluateOutput: NonNullable<IGuardrailService['evaluateOutput']>;
} {
  return typeof (svc as IGuardrailService).evaluateOutput === 'function';
}

/**
 * Result of running input guardrails.
 *
 * Contains the potentially modified input and all evaluation results.
 * Check `evaluation.action` to determine if processing should continue.
 */
export interface GuardrailInputOutcome {
  /** Input after all sanitization (may be modified from original) */
  sanitizedInput: AgentOSInput;

  /** The last evaluation result (for backwards compatibility) */
  evaluation?: GuardrailEvaluationResult | null;

  /** All evaluation results from all guardrails */
  evaluations?: GuardrailEvaluationResult[];
}

/**
 * Options for output guardrail wrapping.
 */
export interface GuardrailOutputOptions {
  /** Stream identifier for error chunks */
  streamId: string;

  /** Persona ID for error chunks */
  personaId?: string;

  /** Input evaluations to attach to first output chunk */
  inputEvaluations?: GuardrailEvaluationResult[] | null;
}

/**
 * Metadata entry attached to response chunks.
 * @internal
 */
interface GuardrailMetadataEntry {
  action: GuardrailAction;
  reason?: string;
  reasonCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Evaluate user input through all registered guardrails.
 *
 * Runs guardrails in sequence, allowing each to modify or block the input.
 * If any guardrail returns {@link GuardrailAction.BLOCK}, evaluation stops
 * immediately and the blocked result is returned.
 *
 * @param service - Single guardrail or array of guardrails to evaluate
 * @param input - User input to evaluate
 * @param context - Conversation context for policy decisions
 * @returns Outcome containing sanitized input and all evaluations
 *
 * @example
 * ```typescript
 * const outcome = await evaluateInputGuardrails(
 *   [contentFilter, piiRedactor],
 *   userInput,
 *   { userId: 'user-123', sessionId: 'session-abc' }
 * );
 *
 * if (outcome.evaluation?.action === GuardrailAction.BLOCK) {
 *   // Input was blocked - return error stream
 *   yield* createGuardrailBlockedStream(context, outcome.evaluation);
 *   return;
 * }
 *
 * // Use sanitized input for orchestration
 * const cleanInput = outcome.sanitizedInput;
 * ```
 */
export async function evaluateInputGuardrails(
  service: IGuardrailService | IGuardrailService[] | undefined,
  input: AgentOSInput,
  context: GuardrailContext,
): Promise<GuardrailInputOutcome> {
  const services = Array.isArray(service)
    ? service.filter(Boolean)
    : service
    ? [service]
    : [];

  if (services.length === 0) {
    return { sanitizedInput: input, evaluations: [] };
  }

  let sanitizedInput = input;
  const evaluations: GuardrailEvaluationResult[] = [];

  for (const currentService of services) {
    if (!currentService?.evaluateInput) {
      continue;
    }

    let evaluation: GuardrailEvaluationResult | null = null;
    try {
      evaluation = await currentService.evaluateInput({ context, input: sanitizedInput });
    } catch (error) {
      console.warn('[AgentOS][Guardrails] evaluateInput failed.', error);
      continue;
    }

    if (!evaluation) {
      continue;
    }

    evaluations.push(evaluation);

    if (evaluation.action === GuardrailAction.SANITIZE && evaluation.modifiedText !== undefined) {
      sanitizedInput = {
        ...sanitizedInput,
        textInput: evaluation.modifiedText,
      };
      continue;
    }

    if (evaluation.action === GuardrailAction.BLOCK) {
      return { sanitizedInput, evaluation, evaluations };
    }
  }

  return {
    sanitizedInput,
    evaluation: evaluations.at(-1) ?? null,
    evaluations,
  };
}

/**
 * Create a stream that emits a single error chunk for blocked content.
 *
 * Use this when input evaluation returns {@link GuardrailAction.BLOCK}
 * to generate an appropriate error response without invoking orchestration.
 *
 * @param context - Guardrail context for the error details
 * @param evaluation - The blocking evaluation result
 * @param options - Stream options (streamId, personaId)
 * @returns Async generator yielding a single ERROR chunk
 *
 * @example
 * ```typescript
 * if (outcome.evaluation?.action === GuardrailAction.BLOCK) {
 *   yield* createGuardrailBlockedStream(
 *     guardrailContext,
 *     outcome.evaluation,
 *     { streamId: 'stream-123', personaId: 'support-agent' }
 *   );
 *   return;
 * }
 * ```
 */
export async function* createGuardrailBlockedStream(
  context: GuardrailContext,
  evaluation: GuardrailEvaluationResult,
  options?: GuardrailOutputOptions,
): AsyncGenerator<AgentOSResponse, void, undefined> {
  const streamId = options?.streamId ?? uuidv4();
  const errorChunk: AgentOSErrorChunk = {
    type: AgentOSResponseChunkType.ERROR,
    streamId,
    gmiInstanceId: 'guardrail',
    personaId: options?.personaId ?? context.personaId ?? 'unknown_persona',
    isFinal: true,
    timestamp: new Date().toISOString(),
    code: evaluation.reasonCode ?? 'GUARDRAIL_BLOCKED',
    message: evaluation.reason ?? 'Request blocked by guardrail policy.',
    details: {
      action: evaluation.action,
      metadata: evaluation.metadata,
      context,
    },
  };
  yield errorChunk;
}

/**
 * Wrap a response stream with guardrail filtering.
 *
 * Creates an async generator that evaluates each chunk through registered
 * guardrails before yielding to the client. Supports both real-time streaming
 * evaluation and final-only evaluation based on guardrail configuration.
 *
 * **Evaluation Strategy:**
 * - Guardrails with `config.evaluateStreamingChunks === true` evaluate TEXT_DELTA chunks
 * - All guardrails evaluate FINAL_RESPONSE chunks (final safety check)
 * - Rate limiting via `config.maxStreamingEvaluations` per guardrail
 *
 * **Actions:**
 * - {@link GuardrailAction.BLOCK} - Terminates stream immediately with error chunk
 * - {@link GuardrailAction.SANITIZE} - Replaces chunk content with `modifiedText`
 * - {@link GuardrailAction.FLAG} / {@link GuardrailAction.ALLOW} - Passes through
 *
 * @param service - Single guardrail or array of guardrails
 * @param context - Conversation context for policy decisions
 * @param stream - Source response stream to wrap
 * @param options - Stream options and input evaluations to attach
 * @returns Wrapped stream with guardrail filtering applied
 *
 * @example
 * ```typescript
 * // Wrap output stream with PII redaction
 * const safeStream = wrapOutputGuardrails(
 *   [piiRedactor, contentFilter],
 *   guardrailContext,
 *   orchestratorStream,
 *   { streamId: 'stream-123', inputEvaluations }
 * );
 *
 * for await (const chunk of safeStream) {
 *   // Chunks are filtered/sanitized before reaching here
 *   yield chunk;
 * }
 * ```
 */
export async function* wrapOutputGuardrails(
  service: IGuardrailService | IGuardrailService[] | undefined,
  context: GuardrailContext,
  stream: AsyncGenerator<AgentOSResponse, void, undefined>,
  options: GuardrailOutputOptions,
): AsyncGenerator<AgentOSResponse, void, undefined> {
  const services = Array.isArray(service)
    ? service.filter(Boolean)
    : service
    ? [service]
    : [];

  // Separate guardrails by evaluation mode
  const streamingGuardrails = services.filter(
    (svc): svc is IGuardrailService & {
      evaluateOutput: NonNullable<IGuardrailService['evaluateOutput']>;
    } => svc.config?.evaluateStreamingChunks === true && hasEvaluateOutput(svc),
  );
  const _finalOnlyGuardrails = services.filter(
    (svc) => svc.config?.evaluateStreamingChunks !== true && typeof svc.evaluateOutput === 'function'
  );

  const guardrailEnabled = services.some((svc) => typeof svc.evaluateOutput === 'function');
  const serializedInputEvaluations = (options.inputEvaluations ?? []).map(serializeEvaluation);
  let inputMetadataApplied = serializedInputEvaluations.length === 0;
  
  // Track streaming evaluations for rate limiting
  const streamingEvaluationCounts = new Map<string, number>();

  for await (const chunk of stream) {
    let currentChunk = chunk;

    if (!inputMetadataApplied && serializedInputEvaluations.length > 0) {
      currentChunk = withGuardrailMetadata(currentChunk, { input: serializedInputEvaluations });
      inputMetadataApplied = true;
    }

    // Evaluate streaming chunks (TEXT_DELTA) if guardrails are configured for it
    if (
      streamingGuardrails.length > 0 &&
      chunk.type === AgentOSResponseChunkType.TEXT_DELTA &&
      !chunk.isFinal
    ) {
      const outputEvaluations: GuardrailEvaluationResult[] = [];
      let workingChunk = currentChunk;

      for (const svc of streamingGuardrails) {
        const svcId = (svc as any).id || 'unknown';
        const currentCount = streamingEvaluationCounts.get(svcId) || 0;
        const maxEvals = svc.config?.maxStreamingEvaluations;

        // Skip if rate limit reached
        if (maxEvals !== undefined && currentCount >= maxEvals) {
          continue;
        }

        let evaluation: GuardrailEvaluationResult | null = null;
        try {
          const evalRes = await svc.evaluateOutput({ context, chunk: workingChunk });
          streamingEvaluationCounts.set(svcId, currentCount + 1);
          evaluation = evalRes ?? null;
        } catch (error) {
          console.warn('[AgentOS][Guardrails] evaluateOutput (streaming) failed.', error);
        }

        if (!evaluation) {
          continue;
        }

        outputEvaluations.push(evaluation);

        if (evaluation.action === GuardrailAction.BLOCK) {
          yield* createGuardrailBlockedStream(context, evaluation, options);
          return;
        }

        // For TEXT_DELTA chunks, sanitize modifies the textDelta field
        if (evaluation.action === GuardrailAction.SANITIZE && evaluation.modifiedText !== undefined) {
          workingChunk = {
            ...(workingChunk as any),
            textDelta: evaluation.modifiedText,
          };
        }
      }

      if (outputEvaluations.length > 0) {
        workingChunk = withGuardrailMetadata(workingChunk, {
          output: outputEvaluations.map(serializeEvaluation),
        });
      }

      currentChunk = workingChunk;
    }

    // Evaluate final chunks (all guardrails)
    if (guardrailEnabled && chunk.isFinal) {
      const outputEvaluations: GuardrailEvaluationResult[] = [];
      let workingChunk = currentChunk;

      for (const svc of services) {
        if (!svc?.evaluateOutput) {
          continue;
        }

        let evaluation: GuardrailEvaluationResult | null = null;
        try {
          evaluation = await svc.evaluateOutput({ context, chunk: workingChunk });
        } catch (error) {
          console.warn('[AgentOS][Guardrails] evaluateOutput (final) failed.', error);
        }

        if (!evaluation) {
          continue;
        }

        outputEvaluations.push(evaluation);

        if (evaluation.action === GuardrailAction.BLOCK) {
          yield* createGuardrailBlockedStream(context, evaluation, options);
          return;
        }

        if (
          evaluation.action === GuardrailAction.SANITIZE &&
          workingChunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
        ) {
          workingChunk = {
            ...(workingChunk as AgentOSFinalResponseChunk),
            finalResponseText:
              evaluation.modifiedText !== undefined
                ? evaluation.modifiedText
                : (workingChunk as AgentOSFinalResponseChunk).finalResponseText,
          };
        }
      }

      if (outputEvaluations.length > 0) {
        workingChunk = withGuardrailMetadata(workingChunk, {
          output: outputEvaluations.map(serializeEvaluation),
        });
      }

      currentChunk = workingChunk;
    }

    yield currentChunk;
  }
}

function serializeEvaluation(evaluation: GuardrailEvaluationResult): GuardrailMetadataEntry {
  return {
    action: evaluation.action,
    reason: evaluation.reason,
    reasonCode: evaluation.reasonCode,
    metadata: evaluation.metadata,
  };
}

function withGuardrailMetadata(
  chunk: AgentOSResponse,
  entry: {
    input?: GuardrailMetadataEntry | GuardrailMetadataEntry[];
    output?: GuardrailMetadataEntry | GuardrailMetadataEntry[];
  },
): AgentOSResponse {
  const existingMetadata = chunk.metadata ?? {};
  const existingGuardrail = (existingMetadata.guardrail as Record<string, unknown>) ?? {};

  const existingInput = Array.isArray(existingGuardrail.input)
    ? (existingGuardrail.input as GuardrailMetadataEntry[])
    : existingGuardrail.input
    ? [existingGuardrail.input as GuardrailMetadataEntry]
    : [];
  const existingOutput = Array.isArray(existingGuardrail.output)
    ? (existingGuardrail.output as GuardrailMetadataEntry[])
    : existingGuardrail.output
    ? [existingGuardrail.output as GuardrailMetadataEntry]
    : [];

  const incomingInput = normalizeMetadata(entry.input);
  const incomingOutput = normalizeMetadata(entry.output);

  const mergedInput = existingInput.concat(incomingInput);
  const mergedOutput = existingOutput.concat(incomingOutput);

  const guardrail: Record<string, unknown> = {
    ...existingGuardrail,
    ...(mergedInput.length ? { input: mergedInput } : {}),
    ...(mergedOutput.length ? { output: mergedOutput } : {}),
  };

  return {
    ...chunk,
    metadata: {
      ...existingMetadata,
      guardrail,
    },
  };
}

function normalizeMetadata(
  entry?: GuardrailMetadataEntry | GuardrailMetadataEntry[],
): GuardrailMetadataEntry[] {
  if (!entry) {
    return [];
  }
  return Array.isArray(entry) ? entry : [entry];
}
