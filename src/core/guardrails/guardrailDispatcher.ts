import { v4 as uuidv4 } from 'uuid';
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
 * Outcome of an input guardrail evaluation.
 */
export interface GuardrailInputOutcome {
  sanitizedInput: AgentOSInput;
  evaluation?: GuardrailEvaluationResult | null;
  evaluations?: GuardrailEvaluationResult[];
}

export interface GuardrailOutputOptions {
  streamId: string;
  personaId?: string;
  inputEvaluations?: GuardrailEvaluationResult[] | null;
}

interface GuardrailMetadataEntry {
  action: GuardrailAction;
  reason?: string;
  reasonCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Runs the guardrail service against the inbound request.
 * Returns the (potentially modified) input and the evaluation metadata.
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
 * Creates an async generator that emits a terminal guardrail error chunk.
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
 * Wraps a response stream and applies guardrail checks before yielding chunks
 * to the host. 
 * 
 * **Evaluation Strategy:**
 * - Guardrails with `config.evaluateStreamingChunks === true` evaluate TEXT_DELTA chunks (real-time)
 * - All guardrails evaluate FINAL_RESPONSE chunks (final check)
 * - This allows cost/performance tradeoffs per guardrail
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
    (svc) => svc.config?.evaluateStreamingChunks === true && typeof svc.evaluateOutput === 'function'
  );
  const finalOnlyGuardrails = services.filter(
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
          evaluation = await svc.evaluateOutput?.({ context, chunk: workingChunk });
          streamingEvaluationCounts.set(svcId, currentCount + 1);
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
