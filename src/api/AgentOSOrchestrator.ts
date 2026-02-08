// File: backend/agentos/api/AgentOSOrchestrator.ts
/**
 * @fileoverview Implements the `AgentOSOrchestrator`, which acts as the central
 * coordinator between the public-facing `AgentOS` API and the internal `GMI`
 * instances. It manages the full lifecycle of an interaction turn, including
 * GMI selection, input preparation, handling GMI's streaming output, and
 * coordinating tool execution and result feedback.
 * @module backend/agentos/api/AgentOSOrchestrator
 */

import { AgentOSInput, ProcessingOptions } from './types/AgentOSInput';
import {
  AgentOSResponse,
  AgentOSResponseChunkType,
  AgentOSTextDeltaChunk,
  AgentOSFinalResponseChunk,
  AgentOSErrorChunk,
  AgentOSSystemProgressChunk,
  AgentOSToolCallRequestChunk,
  AgentOSToolResultEmissionChunk,
  AgentOSUICommandChunk,
  AgentOSMetadataUpdateChunk,
  AgentOSWorkflowUpdateChunk,
} from './types/AgentOSResponse';
import { GMIManager } from '../cognitive_substrate/GMIManager';
import {
  IGMI,
  GMITurnInput,
  GMIOutputChunk,
  GMIOutput,
  ToolCallRequest, // Corrected from ToolCall
  ToolResultPayload,
  GMIInteractionType, // Added for GMITurnInput
  GMIOutputChunkType, // Added for comparisons
  UICommand, // For GMIOutput
} from '../cognitive_substrate/IGMI';
import { ConversationManager } from '../core/conversation/ConversationManager';
import { ConversationContext } from '../core/conversation/ConversationContext';
import { MessageRole } from '../core/conversation/ConversationMessage';
import type { IToolOrchestrator } from '../core/tools/IToolOrchestrator';
import { uuidv4 } from '@framers/agentos/utils/uuid';
import { GMIError, GMIErrorCode } from '@framers/agentos/utils/errors';
import { StreamingManager, StreamId } from '../core/streaming/StreamingManager';
import { normalizeUsage, snapshotPersonaDetails } from '../core/orchestration/helpers';
import type { WorkflowProgressUpdate } from '../core/workflows/WorkflowTypes';
import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import {
  DEFAULT_PROMPT_PROFILE_CONFIG,
  selectPromptProfile,
  type PromptProfileConfig,
  type PromptProfileConversationState,
} from '../core/prompting/PromptProfileRouter';
import {
  DEFAULT_ROLLING_SUMMARY_COMPACTION_CONFIG,
  maybeCompactConversationMessages,
  type RollingSummaryCompactionConfig,
  type RollingSummaryCompactionResult,
} from '../core/conversation/RollingSummaryCompactor';
import type { IRollingSummaryMemorySink, RollingSummaryMemoryUpdate } from '../core/conversation/IRollingSummaryMemorySink';
import type { ILongTermMemoryRetriever } from '../core/conversation/ILongTermMemoryRetriever';
import {
  DEFAULT_LONG_TERM_MEMORY_POLICY,
  hasAnyLongTermMemoryScope,
  LONG_TERM_MEMORY_POLICY_METADATA_KEY,
  resolveLongTermMemoryPolicy,
  type ResolvedLongTermMemoryPolicy,
} from '../core/conversation/LongTermMemoryPolicy';
import {
  getActiveTraceMetadata,
  recordAgentOSToolResultMetrics,
  recordAgentOSTurnMetrics,
  recordExceptionOnActiveSpan,
  runWithSpanContext,
  shouldIncludeTraceInAgentOSResponses,
  startAgentOSSpan,
  withAgentOSSpan,
} from '../core/observability/otel';

export interface RollingSummaryCompactionProfileDefinition {
  config: RollingSummaryCompactionConfig;
  systemPrompt?: string;
}

export interface RollingSummaryCompactionProfilesConfig {
  defaultProfileId: string;
  defaultProfileByMode?: Record<string, string>;
  profiles: Record<string, RollingSummaryCompactionProfileDefinition>;
}

function normalizeMode(value: string): string {
  return (value || '').trim().toLowerCase();
}

function pickByMode(map: Record<string, string> | undefined, mode: string): string | null {
  if (!map || Object.keys(map).length === 0) return null;
  const modeNorm = normalizeMode(mode);
  const exact = map[modeNorm];
  if (exact) return exact;
  const patternMatch = Object.entries(map)
    .map(([key, value]) => ({ key: normalizeMode(key), value }))
    .filter(({ key }) => key && (modeNorm === key || modeNorm.startsWith(key) || modeNorm.includes(key)))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return patternMatch?.value ?? null;
}

function renderPlainText(markdown: string): string {
  let text = String(markdown ?? '');
  if (!text.trim()) return '';

  text = text.replace(/\r\n/g, '\n');
  // Fenced code blocks: keep inner content, drop fences.
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '$1');
  // Inline code.
  text = text.replace(/`([^`]+)`/g, '$1');
  // Images + links.
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Headings + blockquotes.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  // Emphasis / strike-through.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  // Horizontal rules.
  text = text.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '');
  // Basic HTML tags.
  text = text.replace(/<\/?[^>]+>/g, '');

  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * @typedef {Object} AgentOSOrchestratorConfig
 * Configuration options for the AgentOSOrchestrator.
 * @property {number} [maxToolCallIterations=5] - The maximum number of sequential
 * tool calls allowed within a single logical turn to prevent infinite loops.
 * @property {number} [defaultAgentTurnTimeoutMs=120000] - Default timeout for a
 * single GMI processing step (e.g., initial turn or tool result processing).
 * @property {boolean} [enableConversationalPersistence=true] - If true, conversation
 * context will be saved and loaded from persistent storage.
 */
export interface AgentOSOrchestratorConfig {
  maxToolCallIterations?: number;
  defaultAgentTurnTimeoutMs?: number;
  enableConversationalPersistence?: boolean;

  /**
   * Optional prompt-profile routing config. If omitted, a small default router is used.
   * Set to `null` to disable prompt-profile routing entirely.
   */
  promptProfileConfig?: PromptProfileConfig | null;

  /**
   * Optional rolling-summary compaction config. If omitted, a conservative default is used (disabled).
   * Set to `null` to disable rolling-summary compaction entirely.
   */
  rollingSummaryCompactionConfig?: RollingSummaryCompactionConfig | null;

  /**
   * Optional rolling-summary compaction profiles. When provided, the orchestrator selects a compaction
   * profile per-turn based on `mode` (customFlags.mode or persona id) and uses it instead of the
   * single `rollingSummaryCompactionConfig`.
   */
  rollingSummaryCompactionProfilesConfig?: RollingSummaryCompactionProfilesConfig | null;

  /** Optional system prompt override for rolling-summary compaction. */
  rollingSummarySystemPrompt?: string;

  /** Optional metadata key to store rolling-summary state under (defaults to `rollingSummaryState`). */
  rollingSummaryStateKey?: string;
}

/**
 * @typedef {Object} AgentOSOrchestratorDependencies
 * Defines the dependencies required by the AgentOSOrchestrator.
 * These are typically injected during its initialization.
 * @property {GMIManager} gmiManager - Manager for GMI instances and persona definitions.
 * @property {ToolOrchestrator} toolOrchestrator - Orchestrates the execution of tools.
 * @property {ConversationManager} conversationManager - Manages loading and saving
 * of persistent conversation contexts.
 * @property {StreamingManager} streamingManager - Manages streaming responses to clients.
 */
export interface AgentOSOrchestratorDependencies {
  gmiManager: GMIManager;
  toolOrchestrator: IToolOrchestrator;
  conversationManager: ConversationManager;
  streamingManager: StreamingManager;
  modelProviderManager: AIModelProviderManager;
  /**
   * Optional sink for persisting rolling-memory outputs (`summary_markdown` + `memory_json`)
   * into a long-term store (RAG / knowledge graph / database).
   */
  rollingSummaryMemorySink?: IRollingSummaryMemorySink;
  /**
   * Optional long-term memory retriever. When provided, AgentOS can inject
   * durable memories (user/persona/org) into prompts on a cadence.
   */
  longTermMemoryRetriever?: ILongTermMemoryRetriever;
}

/**
 * Internal state for managing an active stream of GMI interaction.
 * @interface ActiveStreamContext
 * @private
 */
interface ActiveStreamContext {
  gmi: IGMI;
  userId: string;
  sessionId: string; // AgentOS session ID
  personaId: string;
  conversationId: string; // Can be same as sessionId or a more specific conversation thread ID
  conversationContext: ConversationContext;
  userApiKeys?: Record<string, string>;
  processingOptions?: ProcessingOptions;
  languageNegotiation?: any; // multilingual negotiation metadata
  // Iterator is managed within the orchestrateTurn method directly
}

type LongTermMemoryRetrievalState = {
  lastReviewedUserTurn: number;
  lastReviewedAt?: number;
};


/**
 * @class AgentOSOrchestrator
 * @description
 * The `AgentOSOrchestrator` is responsible for unifying the request handling
 * pipeline for AgentOS. It bridges the high-level `AgentOSInput` from the
 * public API to the internal `GMI` processing logic. It ensures that user
 * requests are routed to the correct GMI, manages the GMI's turn lifecycle,
 * and handles the complex dance of tool calls and streaming responses.
 */
export class AgentOSOrchestrator {
  private initialized: boolean = false;
  private config!: Required<AgentOSOrchestratorConfig>;
  private dependencies!: AgentOSOrchestratorDependencies;

  /**
   * A map to hold ongoing stream contexts.
   * Key: streamId (generated by orchestrator for this interaction flow).
   * Value: ActiveStreamContext.
   * @private
   */
  private activeStreamContexts: Map<string, ActiveStreamContext> = new Map();

  constructor() {}

  /**
   * Initializes the AgentOSOrchestrator with its configuration and dependencies.
   * This method must be called successfully before orchestrating any turns.
   *
   * @public
   * @async
   * @param {AgentOSOrchestratorConfig} config - Configuration settings for the orchestrator.
   * @param {AgentOSOrchestratorDependencies} dependencies - Required services.
   * @returns {Promise<void>} A Promise that resolves when initialization is complete.
   * @throws {GMIError} If any critical dependency is missing or config is invalid.
   */
  public async initialize(
    config: AgentOSOrchestratorConfig,
    dependencies: AgentOSOrchestratorDependencies,
  ): Promise<void> {
    if (this.initialized) {
      console.warn('AgentOSOrchestrator already initialized. Skipping re-initialization.');
      return;
    }

    if (!dependencies.gmiManager || !dependencies.toolOrchestrator || !dependencies.conversationManager || !dependencies.streamingManager || !dependencies.modelProviderManager) {
      throw new GMIError(
        'AgentOSOrchestrator: Missing essential dependencies (gmiManager, toolOrchestrator, conversationManager, streamingManager, modelProviderManager).',
        GMIErrorCode.CONFIGURATION_ERROR,
      );
    }

    this.config = {
      maxToolCallIterations: config.maxToolCallIterations ?? 5,
      defaultAgentTurnTimeoutMs: config.defaultAgentTurnTimeoutMs ?? 120000,
      enableConversationalPersistence: config.enableConversationalPersistence ?? true,
      promptProfileConfig: config.promptProfileConfig === null
        ? null
        : (config.promptProfileConfig ?? DEFAULT_PROMPT_PROFILE_CONFIG),
      rollingSummaryCompactionConfig: config.rollingSummaryCompactionConfig === null
        ? null
        : { ...DEFAULT_ROLLING_SUMMARY_COMPACTION_CONFIG, ...(config.rollingSummaryCompactionConfig ?? {}) },
      rollingSummaryCompactionProfilesConfig: config.rollingSummaryCompactionProfilesConfig ?? null,
      rollingSummarySystemPrompt: config.rollingSummarySystemPrompt ?? '',
      rollingSummaryStateKey: config.rollingSummaryStateKey ?? 'rollingSummaryState',
    };
    this.dependencies = dependencies;
    this.initialized = true;
    console.log('AgentOSOrchestrator initialized.');
  }

  /**
   * Ensures the orchestrator is initialized.
   * @private
   * @throws {GMIError} If not initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new GMIError('AgentOSOrchestrator is not initialized. Call initialize() first.', GMIErrorCode.NOT_INITIALIZED);
    }
  }

  /**
   * Helper method to create and push response chunks via StreamingManager.
   * @private
   */
  private async pushChunkToStream(
    streamId: StreamId,
    type: AgentOSResponseChunkType,
    gmiInstanceId: string,
    personaId: string,
    isFinal: boolean,
    data: any
  ): Promise<void> {
    const baseChunk: Record<string, any> = {
      type,
      streamId,
      gmiInstanceId,
      personaId,
      isFinal,
      timestamp: new Date().toISOString(),
    };

    if (data && typeof data === 'object' && 'metadata' in data && data.metadata) {
      baseChunk.metadata = data.metadata;
    }
    const ctx = this.activeStreamContexts.get(streamId);
    if (ctx?.languageNegotiation) {
      baseChunk.metadata = baseChunk.metadata || {};
      if (!baseChunk.metadata.language) baseChunk.metadata.language = ctx.languageNegotiation;
    }

    if (
      shouldIncludeTraceInAgentOSResponses() &&
      (type === AgentOSResponseChunkType.METADATA_UPDATE ||
        type === AgentOSResponseChunkType.FINAL_RESPONSE ||
        type === AgentOSResponseChunkType.ERROR)
    ) {
      const traceMeta = getActiveTraceMetadata();
      if (traceMeta) {
        baseChunk.metadata = baseChunk.metadata || {};
        baseChunk.metadata.trace = traceMeta;
      }
    }

    let chunk: AgentOSResponse;

    switch (type) {
      case AgentOSResponseChunkType.TEXT_DELTA:
        chunk = { ...baseChunk, textDelta: data.textDelta } as AgentOSTextDeltaChunk;
        break;
      case AgentOSResponseChunkType.SYSTEM_PROGRESS:
        chunk = {
          ...baseChunk,
          message: data.message,
          progressPercentage: data.progressPercentage,
          statusCode: data.statusCode,
        } as AgentOSSystemProgressChunk;
        break;
      case AgentOSResponseChunkType.TOOL_CALL_REQUEST:
        chunk = {
          ...baseChunk,
          toolCalls: data.toolCalls,
          rationale: data.rationale,
        } as AgentOSToolCallRequestChunk;
        break;
      case AgentOSResponseChunkType.TOOL_RESULT_EMISSION:
        chunk = {
          ...baseChunk,
          toolCallId: data.toolCallId,
          toolName: data.toolName,
          toolResult: data.toolResult,
          isSuccess: data.isSuccess,
          errorMessage: data.errorMessage,
        } as AgentOSToolResultEmissionChunk;
        break;
      case AgentOSResponseChunkType.UI_COMMAND:
        chunk = { ...baseChunk, uiCommands: data.uiCommands } as AgentOSUICommandChunk;
        break;
      case AgentOSResponseChunkType.ERROR:
        chunk = {
          ...baseChunk,
          code: data.code,
          message: data.message,
          details: data.details,
        } as AgentOSErrorChunk;
        break;
      case AgentOSResponseChunkType.FINAL_RESPONSE:
        chunk = {
          ...baseChunk,
          finalResponseText: data.finalResponseText,
          finalToolCalls: data.finalToolCalls,
          finalUiCommands: data.finalUiCommands,
          audioOutput: data.audioOutput,
          imageOutput: data.imageOutput,
          usage: normalizeUsage(data.usage),
          reasoningTrace: data.reasoningTrace,
          error: data.error,
          updatedConversationContext: data.updatedConversationContext,
          activePersonaDetails: data.activePersonaDetails,
        } as AgentOSFinalResponseChunk;
        break;
      case AgentOSResponseChunkType.WORKFLOW_UPDATE:
        chunk = {
          ...baseChunk,
          workflow: data.workflow,
        } as AgentOSWorkflowUpdateChunk;
        break;
      case AgentOSResponseChunkType.METADATA_UPDATE:
        chunk = {
          ...baseChunk,
          updates: data.updates,
        } as AgentOSMetadataUpdateChunk;
        break;
      default:
        console.error(
          `AgentOSOrchestrator: Unknown chunk type encountered in pushChunkToStream: ${type}`,
        );
        chunk = {
          ...baseChunk,
          type: AgentOSResponseChunkType.ERROR,
          code: GMIErrorCode.INTERNAL_SERVER_ERROR,
          message: `Unknown chunk type: ${type}`,
          details: data,
        } as AgentOSErrorChunk;
    }
    try {
      await this.dependencies.streamingManager.pushChunk(streamId, chunk);
    } catch (pushError: any) {
      // Gracefully handle attempts to push after a stream is closed or missing
      console.error(
        `AgentOSOrchestrator: Failed to push chunk to stream ${streamId}. Type: ${type}. Error: ${pushError?.message}`,
        pushError
      );
    }
  }

  public async broadcastWorkflowUpdate(update: WorkflowProgressUpdate): Promise<void> {
    this.ensureInitialized();
    const targets: Array<{ streamId: StreamId; context: ActiveStreamContext }> = [];

    for (const [streamId, context] of this.activeStreamContexts.entries()) {
      if (
        update.workflow.conversationId &&
        context.conversationId !== update.workflow.conversationId
      ) {
        continue;
      }
      targets.push({ streamId, context });
    }

    if (targets.length === 0) {
      console.debug('AgentOSOrchestrator: No active streams for workflow update', {
        workflowId: update.workflow.workflowId,
        conversationId: update.workflow.conversationId,
      });
      return;
    }

    await Promise.allSettled(
      targets.map(async ({ streamId, context }) => {
        const gmiId = context.gmi.getGMIId();
        const metadata = {
          workflowId: update.workflow.workflowId,
          definitionId: update.workflow.definitionId,
          conversationId: update.workflow.conversationId,
          status: update.workflow.status,
        };
        await this.pushChunkToStream(
          streamId,
          AgentOSResponseChunkType.WORKFLOW_UPDATE,
          gmiId,
          context.personaId,
          false,
          {
            workflow: update,
            metadata,
          },
        );
      }),
    );
  }

  /**
   * Helper method to create and push error chunks.
   * @private
   */
  private async pushErrorChunk(
    streamId: StreamId,
    personaId: string,
    gmiInstanceId: string = 'unknown_gmi_instance',
    code: GMIErrorCode | string,
    message: string,
    details?: any
  ): Promise<void> {
    await this.pushChunkToStream(
      streamId,
      AgentOSResponseChunkType.ERROR,
      gmiInstanceId,
      personaId,
      true, // Errors are usually final for the current operation
      { code: code.toString(), message, details }
    );
  }

  /**
   * Orchestrates a full logical turn for a user request.
   * This involves managing GMI interaction, tool calls, and streaming responses.
   * Instead of directly yielding, it uses the StreamingManager to push chunks.
   *
   * @public
   * @async
   * @param {AgentOSInput} input - The comprehensive input for the current turn.
   * @returns {Promise<StreamId>} The ID of the stream to which responses will be pushed.
   * @throws {GMIError} If critical initialization or setup fails.
   */
  public async orchestrateTurn(input: AgentOSInput): Promise<StreamId> {
    this.ensureInitialized();
    const agentOSStreamId = await this.dependencies.streamingManager.createStream();
    console.log(`AgentOSOrchestrator: Starting turn for AgentOS Stream ${agentOSStreamId}, User ${input.userId}, Session ${input.sessionId}`);

    const rootSpan = startAgentOSSpan('agentos.turn', {
      attributes: {
        'agentos.stream_id': agentOSStreamId,
        'agentos.user_id': input.userId,
        'agentos.session_id': input.sessionId,
        'agentos.conversation_id': input.conversationId ?? '',
        'agentos.persona_id': input.selectedPersonaId ?? '',
      },
    });

    const run = async () => this._processTurnInternal(agentOSStreamId, input);

    const promise = rootSpan ? runWithSpanContext(rootSpan, run) : run();

    // Execute the turn processing asynchronously without awaiting it here,
    // so this method can return the streamId quickly.
    promise
      .catch(async (criticalError: any) => {
        if (rootSpan) {
          try {
            rootSpan.recordException(criticalError);
          } catch {
            // ignore
          }
        }

        console.error(
          `AgentOSOrchestrator: Critical unhandled error in _processTurnInternal for stream ${agentOSStreamId}:`,
          criticalError,
        );
        try {
          await this.pushErrorChunk(
            agentOSStreamId,
            input.selectedPersonaId || 'unknown_persona',
            'orchestrator_critical',
            GMIErrorCode.INTERNAL_SERVER_ERROR,
            `A critical orchestration error occurred: ${criticalError.message}`,
            { name: criticalError.name, stack: criticalError.stack },
          );
          await this.dependencies.streamingManager.closeStream(
            agentOSStreamId,
            'Critical orchestrator error',
          );
        } catch (cleanupError: any) {
          console.error(
            `AgentOSOrchestrator: Error during critical error cleanup for stream ${agentOSStreamId}:`,
            cleanupError,
          );
        }
        this.activeStreamContexts.delete(agentOSStreamId);
      })
      .finally(() => {
        try {
          rootSpan?.end();
        } catch {
          // ignore
        }
      });

    return agentOSStreamId;
  }
  
  /**
   * Internal processing logic for a turn, designed to be called without await by `orchestrateTurn`.
   * @private
   */
  private async _processTurnInternal(agentOSStreamId: StreamId, input: AgentOSInput): Promise<void> {
    const turnStartedAt = Date.now();
    let turnMetricsStatus: 'ok' | 'error' = 'ok';
    let turnMetricsPersonaId: string | undefined = input.selectedPersonaId;
    let turnMetricsUsage:
      | {
          totalTokens?: number;
          promptTokens?: number;
          completionTokens?: number;
          totalCostUSD?: number;
        }
      | undefined;

    const selectedPersonaId = input.selectedPersonaId;

    let gmi: IGMI | undefined;
    let conversationContext: ConversationContext | undefined;
    let currentPersonaId = input.selectedPersonaId;
    let gmiInstanceIdForChunks = 'gmi_pending_init';
    let organizationIdForMemory: string | undefined;
    let longTermMemoryPolicy: ResolvedLongTermMemoryPolicy | null = null;
    let didForceTerminate = false;

    try {
      if (!selectedPersonaId) {
        throw new GMIError(
          'AgentOSOrchestrator requires a selectedPersonaId on AgentOSInput.',
          GMIErrorCode.VALIDATION_ERROR,
        );
      }

      const gmiResult = await withAgentOSSpan('agentos.gmi.get_or_create', async (span) => {
        span?.setAttribute('agentos.user_id', input.userId);
        span?.setAttribute('agentos.session_id', input.sessionId);
        span?.setAttribute('agentos.persona_id', selectedPersonaId);
        if (typeof input.conversationId === 'string' && input.conversationId.trim()) {
          span?.setAttribute('agentos.conversation_id', input.conversationId.trim());
        }
        return this.dependencies.gmiManager.getOrCreateGMIForSession(
          input.userId,
          input.sessionId, // This is AgentOS's session ID, GMI might have its own.
          selectedPersonaId,
          input.conversationId, // Can be undefined, GMIManager might default to sessionId.
          input.options?.preferredModelId,
          input.options?.preferredProviderId,
          input.userApiKeys,
        );
      });
      gmi = gmiResult.gmi;
      conversationContext = gmiResult.conversationContext;
      currentPersonaId = gmi.getCurrentPrimaryPersonaId(); // Get actual personaId from GMI
      gmiInstanceIdForChunks = gmi.getGMIId();
      turnMetricsPersonaId = currentPersonaId;


      const streamContext: ActiveStreamContext = {
        gmi, userId: input.userId, sessionId: input.sessionId, personaId: currentPersonaId,
        conversationId: conversationContext.sessionId, // Use actual conversation ID from context
        conversationContext, userApiKeys: input.userApiKeys, processingOptions: input.options
      };
      this.activeStreamContexts.set(agentOSStreamId, streamContext);

      await this.pushChunkToStream(
        agentOSStreamId, AgentOSResponseChunkType.SYSTEM_PROGRESS,
        gmiInstanceIdForChunks, currentPersonaId, false,
        { message: `Initializing persona ${currentPersonaId}... GMI: ${gmiInstanceIdForChunks}`, progressPercentage: 10 }
      );

      const gmiInput = this.constructGMITurnInput(agentOSStreamId, input, streamContext);

      // --- Org context + long-term memory policy (persisted per conversation) ---
      if (conversationContext) {
        const inboundOrg =
          typeof input.organizationId === 'string' ? input.organizationId.trim() : '';
        // SECURITY NOTE: do not persist organizationId in conversation metadata. The org context
        // should be asserted by the trusted caller each request (after membership checks).
        organizationIdForMemory = inboundOrg || undefined;

        const rawPrevPolicy = conversationContext.getMetadata(LONG_TERM_MEMORY_POLICY_METADATA_KEY);
        const prevPolicy =
          rawPrevPolicy && typeof rawPrevPolicy === 'object'
            ? (rawPrevPolicy as ResolvedLongTermMemoryPolicy)
            : null;
        const inputPolicy = input.memoryControl?.longTermMemory ?? null;

        longTermMemoryPolicy = resolveLongTermMemoryPolicy({
          previous: prevPolicy,
          input: inputPolicy,
          defaults: DEFAULT_LONG_TERM_MEMORY_POLICY,
        });

        // Only write back when the client supplies overrides or no prior policy exists.
        if (inputPolicy || !prevPolicy) {
          conversationContext.setMetadata(LONG_TERM_MEMORY_POLICY_METADATA_KEY, longTermMemoryPolicy);
        }
      } else {
        organizationIdForMemory =
          typeof input.organizationId === 'string' ? input.organizationId.trim() : undefined;
        longTermMemoryPolicy = resolveLongTermMemoryPolicy({
          defaults: DEFAULT_LONG_TERM_MEMORY_POLICY,
        });
      }

      (gmiInput.metadata ??= {} as any).organizationId = organizationIdForMemory ?? null;
      (gmiInput.metadata as any).longTermMemoryPolicy = longTermMemoryPolicy;

      // Persist inbound user/system message to ConversationContext BEFORE any LLM call so persona switches
      // and restarts preserve memory, even if the LLM fails.
      if (this.config.enableConversationalPersistence && conversationContext) {
        const persistContext = conversationContext;
        try {
          if (gmiInput.type === GMIInteractionType.TEXT && typeof gmiInput.content === 'string') {
            conversationContext.addMessage({
              role: MessageRole.USER,
              content: gmiInput.content,
              name: input.userId,
              metadata: { agentPersonaId: currentPersonaId, source: 'agentos_input' },
            });
          } else if (gmiInput.type === GMIInteractionType.MULTIMODAL_CONTENT) {
            conversationContext.addMessage({
              role: MessageRole.USER,
              content: JSON.stringify(gmiInput.content),
              name: input.userId,
              metadata: { agentPersonaId: currentPersonaId, source: 'agentos_input_multimodal' },
            });
          } else if (gmiInput.type === GMIInteractionType.SYSTEM_MESSAGE) {
            conversationContext.addMessage({
              role: MessageRole.SYSTEM,
              content: typeof gmiInput.content === 'string' ? gmiInput.content : JSON.stringify(gmiInput.content),
              metadata: { agentPersonaId: currentPersonaId, source: 'agentos_input_system' },
            });
          }
          await withAgentOSSpan('agentos.conversation.save', async (span) => {
            span?.setAttribute('agentos.stage', 'inbound');
            span?.setAttribute('agentos.stream_id', agentOSStreamId);
            await this.dependencies.conversationManager.saveConversation(persistContext);
          });
        } catch (persistError: any) {
          console.warn(
            `AgentOSOrchestrator: Failed to persist inbound message to ConversationContext for stream ${agentOSStreamId}.`,
            persistError,
          );
        }
      }

      // Build conversationHistoryForPrompt after compaction/routing so it can reflect rolling-summary trimming.

      const modeForRouting =
        typeof input.options?.customFlags?.mode === 'string' && input.options.customFlags.mode.trim()
          ? input.options.customFlags.mode.trim()
          : currentPersonaId;

      // --- Rolling summary compaction (text + JSON metadata) ---
      let rollingSummaryResult: RollingSummaryCompactionResult | null = null;
      let rollingSummaryProfileId: string | null = null;
      let rollingSummaryConfigForTurn: RollingSummaryCompactionConfig | null = this.config.rollingSummaryCompactionConfig;
      let rollingSummarySystemPromptForTurn: string | undefined = this.config.rollingSummarySystemPrompt;

      if (this.config.rollingSummaryCompactionProfilesConfig) {
        const profilesConfig = this.config.rollingSummaryCompactionProfilesConfig;
        const picked =
          pickByMode(profilesConfig.defaultProfileByMode, modeForRouting) ??
          profilesConfig.defaultProfileId;
        rollingSummaryProfileId = picked;
        const profile = profilesConfig.profiles?.[picked];
        if (profile?.config) {
          rollingSummaryConfigForTurn = profile.config;
        }
        if (profile?.systemPrompt) {
          rollingSummarySystemPromptForTurn = profile.systemPrompt;
        }
      }

      if (conversationContext && rollingSummaryConfigForTurn) {
        try {
          const llmCaller = async (call: {
            providerId?: string;
            modelId: string;
            messages: any[];
            options: any;
          }): Promise<string> => {
            const providerIdResolved =
              call.providerId ||
              this.dependencies.modelProviderManager.getProviderForModel(call.modelId)?.providerId ||
              this.dependencies.modelProviderManager.getDefaultProvider()?.providerId;
            if (!providerIdResolved) {
              throw new Error(`No provider resolved for rolling-summary model '${call.modelId}'.`);
            }
            const provider = this.dependencies.modelProviderManager.getProvider(providerIdResolved);
            if (!provider) {
              throw new Error(`Provider '${providerIdResolved}' not found for rolling-summary compaction.`);
            }
            const response = await provider.generateCompletion(call.modelId, call.messages, call.options);
            const choice = response?.choices?.[0];
            const responseContent = choice?.message?.content ?? choice?.text ?? '';
            if (typeof responseContent === 'string') return responseContent.trim();
            if (Array.isArray(responseContent)) {
              return responseContent
                .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
                .filter(Boolean)
                .join('\n')
                .trim();
            }
            return String(responseContent ?? '').trim();
          };

          const stateKey = this.config.rollingSummaryStateKey;
          const compaction = await maybeCompactConversationMessages({
            messages: conversationContext.getAllMessages() as any,
            sessionMetadata: conversationContext.getAllMetadata() as any,
            config: rollingSummaryConfigForTurn,
            llmCaller: ({ providerId, modelId, messages, options }) =>
              llmCaller({ providerId, modelId, messages, options }),
            systemPrompt: rollingSummarySystemPromptForTurn,
            stateKey,
          });

          rollingSummaryResult = compaction;
          if (compaction.updatedSessionMetadata && Object.prototype.hasOwnProperty.call(compaction.updatedSessionMetadata, stateKey)) {
            conversationContext.setMetadata(stateKey, (compaction.updatedSessionMetadata as any)[stateKey]);
          }
        } catch (compactionError: any) {
          console.warn(
            `AgentOSOrchestrator: Rolling summary compaction failed for stream ${agentOSStreamId} (continuing without it).`,
            compactionError,
          );
        }
      }

      if (!gmiInput.metadata) {
        gmiInput.metadata = {};
      }
      const rollingSummaryEnabled = Boolean(rollingSummaryConfigForTurn?.enabled);
      const rollingSummaryText =
        rollingSummaryEnabled && typeof rollingSummaryResult?.summaryText === 'string'
          ? rollingSummaryResult.summaryText.trim()
          : '';
      (gmiInput.metadata as any).rollingSummary =
        rollingSummaryEnabled && rollingSummaryText
          ? { text: rollingSummaryText, json: rollingSummaryResult?.summaryJson ?? undefined }
          : null;

      // --- Prompt-profile routing (concise/deep/planner/reviewer) ---
      let promptProfileSelection: ReturnType<typeof selectPromptProfile>['result'] | null = null;
      if (conversationContext && this.config.promptProfileConfig) {
        try {
          const rawPrev = conversationContext.getMetadata('promptProfileState');
          const previousState: PromptProfileConversationState | null =
            rawPrev && typeof rawPrev === 'object' && typeof (rawPrev as any).presetId === 'string'
              ? (rawPrev as PromptProfileConversationState)
              : null;

          const userMessageForRouting =
            gmiInput.type === GMIInteractionType.TEXT && typeof gmiInput.content === 'string'
              ? gmiInput.content
              : gmiInput.type === GMIInteractionType.MULTIMODAL_CONTENT
                ? JSON.stringify(gmiInput.content)
                : '';

          const selection = selectPromptProfile(
            this.config.promptProfileConfig,
            {
              conversationId: conversationContext.sessionId,
              mode: modeForRouting,
              userMessage: userMessageForRouting,
              didCompact: Boolean(rollingSummaryResult?.didCompact),
            },
            previousState,
          );
          promptProfileSelection = selection.result;
          conversationContext.setMetadata('promptProfileState', selection.nextState);
        } catch (routerError: any) {
          console.warn(
            `AgentOSOrchestrator: Prompt-profile routing failed for stream ${agentOSStreamId} (continuing without it).`,
            routerError,
          );
        }
      }

      (gmiInput.metadata as any).promptProfile = promptProfileSelection
        ? {
            id: promptProfileSelection.presetId,
            systemInstructions: promptProfileSelection.systemInstructions,
            reason: promptProfileSelection.reason,
          }
        : null;

      // --- Long-term memory retrieval (user/persona/org) ---
      let longTermMemoryContextText: string | null = null;
      let longTermMemoryRetrievalDiagnostics: Record<string, unknown> | undefined;

      if (
        conversationContext &&
        this.dependencies.longTermMemoryRetriever &&
        Boolean(longTermMemoryPolicy?.enabled) &&
        (Boolean(longTermMemoryPolicy?.scopes?.user) ||
          Boolean(longTermMemoryPolicy?.scopes?.persona) ||
          Boolean(longTermMemoryPolicy?.scopes?.organization))
      ) {
        try {
          const queryText =
            gmiInput.type === GMIInteractionType.TEXT && typeof gmiInput.content === 'string'
              ? gmiInput.content.trim()
              : gmiInput.type === GMIInteractionType.MULTIMODAL_CONTENT
                ? JSON.stringify(gmiInput.content).trim()
                : '';

          const userTurnCount = (conversationContext.getAllMessages() as any[]).filter(
            (m) => m?.role === MessageRole.USER,
          ).length;

          const cadenceTurns =
            typeof (this.config.promptProfileConfig as any)?.routing?.reviewEveryNTurns === 'number'
              ? Number((this.config.promptProfileConfig as any).routing.reviewEveryNTurns)
              : 6;
          const forceOnCompaction =
            typeof (this.config.promptProfileConfig as any)?.routing?.forceReviewOnCompaction === 'boolean'
              ? Boolean((this.config.promptProfileConfig as any).routing.forceReviewOnCompaction)
              : true;

          const rawState = conversationContext.getMetadata('longTermMemoryRetrievalState');
          const prevState: LongTermMemoryRetrievalState | null =
            rawState &&
            typeof rawState === 'object' &&
            typeof (rawState as any).lastReviewedUserTurn === 'number'
              ? (rawState as LongTermMemoryRetrievalState)
              : null;

          const shouldReview =
            !prevState ||
            (cadenceTurns > 0 && userTurnCount - prevState.lastReviewedUserTurn >= cadenceTurns) ||
            (forceOnCompaction && Boolean(rollingSummaryResult?.didCompact));

          if (shouldReview && queryText.length > 0) {
            const retrievalResult = await this.dependencies.longTermMemoryRetriever.retrieveLongTermMemory({
              userId: streamContext.userId,
              organizationId: organizationIdForMemory,
              conversationId: streamContext.conversationId,
              personaId: currentPersonaId,
              mode: modeForRouting,
              queryText,
              memoryPolicy: longTermMemoryPolicy ?? DEFAULT_LONG_TERM_MEMORY_POLICY,
              maxContextChars: 2800,
              topKByScope: { user: 6, persona: 6, organization: 6 },
            });

            if (retrievalResult?.contextText && retrievalResult.contextText.trim()) {
              longTermMemoryContextText = retrievalResult.contextText.trim();
              longTermMemoryRetrievalDiagnostics = retrievalResult.diagnostics;
            }

            conversationContext.setMetadata('longTermMemoryRetrievalState', {
              lastReviewedUserTurn: userTurnCount,
              lastReviewedAt: Date.now(),
            } satisfies LongTermMemoryRetrievalState);
          }
        } catch (retrievalError: any) {
          console.warn(
            `AgentOSOrchestrator: Long-term memory retrieval failed for stream ${agentOSStreamId} (continuing without it).`,
            retrievalError,
          );
        }
      }

      (gmiInput.metadata as any).longTermMemoryContext =
        typeof longTermMemoryContextText === 'string' && longTermMemoryContextText.length > 0
          ? longTermMemoryContextText
          : null;

      // Provide a durable history snapshot for prompt construction so persona switches share memory.
      // When rolling-summary compaction is enabled and a summary exists, trim history to:
      // - keep the configured head messages verbatim
      // - keep only messages after `summaryUptoTimestamp` (unsummarized tail)
      if (conversationContext) {
        const excludeRoles = new Set<MessageRole>([MessageRole.ERROR, MessageRole.THOUGHT]);
        const useTrimmedHistory =
          rollingSummaryEnabled &&
          typeof rollingSummaryResult?.summaryUptoTimestamp === 'number' &&
          rollingSummaryText.length > 0;

        const rawHistory = useTrimmedHistory
          ? (conversationContext.getAllMessages() as any[])
          : (conversationContext.getHistory(undefined, [MessageRole.ERROR, MessageRole.THOUGHT]) as any[]);

        let historyForPrompt = rawHistory.filter((m) => m && !excludeRoles.has(m.role)) as any[];

        const last = historyForPrompt[historyForPrompt.length - 1];
        if (last?.role === MessageRole.USER) {
          const content = typeof last.content === 'string' ? last.content.trim() : '';
          const inbound =
            gmiInput.type === GMIInteractionType.TEXT && typeof gmiInput.content === 'string'
              ? gmiInput.content.trim()
              : gmiInput.type === GMIInteractionType.MULTIMODAL_CONTENT
                ? JSON.stringify(gmiInput.content).trim()
                : '';
          if (content && inbound && content === inbound) {
            historyForPrompt = historyForPrompt.slice(0, -1);
          }
        }

        if (useTrimmedHistory) {
          const headCount = Math.max(0, rollingSummaryConfigForTurn?.headMessagesToKeep ?? 0);
          const head = historyForPrompt.slice(0, Math.min(headCount, historyForPrompt.length));
          const afterSummary = historyForPrompt.filter((m: any) => m && m.timestamp > (rollingSummaryResult as any).summaryUptoTimestamp);
          const merged: any[] = [];
          const seen = new Set<string>();
          for (const msg of [...head, ...afterSummary]) {
            const id = typeof msg?.id === 'string' ? msg.id : '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            merged.push(msg);
          }
          historyForPrompt = merged;
        }

        (gmiInput.metadata as any).conversationHistoryForPrompt = historyForPrompt as any[];
      }

      // Persist any compaction/router metadata updates prior to the main LLM call.
      if (this.config.enableConversationalPersistence && conversationContext) {
        const persistContext = conversationContext;
        try {
          await withAgentOSSpan('agentos.conversation.save', async (span) => {
            span?.setAttribute('agentos.stage', 'metadata');
            span?.setAttribute('agentos.stream_id', agentOSStreamId);
            await this.dependencies.conversationManager.saveConversation(persistContext);
          });
        } catch (metadataPersistError: any) {
          console.warn(
            `AgentOSOrchestrator: Failed to persist conversation metadata updates for stream ${agentOSStreamId}.`,
            metadataPersistError,
          );
        }
      }

      // Best-effort: persist structured rolling memory (`memory_json`) to an external store for retrieval.
      if (
        rollingSummaryEnabled &&
        rollingSummaryResult?.didCompact &&
        typeof rollingSummaryResult.summaryText === 'string' &&
        this.dependencies.rollingSummaryMemorySink &&
        Boolean(longTermMemoryPolicy?.enabled) &&
        hasAnyLongTermMemoryScope(longTermMemoryPolicy ?? DEFAULT_LONG_TERM_MEMORY_POLICY)
      ) {
        const update: RollingSummaryMemoryUpdate = {
          userId: streamContext.userId,
          organizationId: organizationIdForMemory,
          sessionId: streamContext.sessionId,
          conversationId: streamContext.conversationId,
          personaId: currentPersonaId,
          mode: modeForRouting,
          profileId: rollingSummaryProfileId,
          memoryPolicy: longTermMemoryPolicy ?? undefined,
          summaryText: rollingSummaryResult.summaryText,
          summaryJson: rollingSummaryResult.summaryJson ?? null,
          summaryUptoTimestamp: rollingSummaryResult.summaryUptoTimestamp ?? null,
          summaryUpdatedAt: rollingSummaryResult.summaryUpdatedAt ?? null,
        };
        void this.dependencies.rollingSummaryMemorySink
          .upsertRollingSummaryMemory(update)
          .catch((error: any) => {
            console.warn(
              `AgentOSOrchestrator: Rolling summary sink failed for stream ${agentOSStreamId} (continuing).`,
              error,
            );
          });
      }

      // Emit routing + memory metadata as a first-class chunk for clients.
      await this.pushChunkToStream(
        agentOSStreamId,
        AgentOSResponseChunkType.METADATA_UPDATE,
        gmiInstanceIdForChunks,
        currentPersonaId,
        false,
        {
          updates: {
            promptProfile: promptProfileSelection,
            organizationId: organizationIdForMemory ?? null,
            longTermMemoryPolicy,
            longTermMemoryRetrieval: longTermMemoryContextText
              ? {
                  didRetrieve: true,
                  contextChars: longTermMemoryContextText.length,
                  diagnostics: longTermMemoryRetrievalDiagnostics,
                }
              : { didRetrieve: false },
            rollingSummary: rollingSummaryResult
              ? {
                  profileId: rollingSummaryProfileId,
                  enabled: rollingSummaryResult.enabled,
                  didCompact: rollingSummaryResult.didCompact,
                  summaryText: rollingSummaryResult.summaryText,
                  summaryJson: rollingSummaryResult.summaryJson,
                  summaryUptoTimestamp: rollingSummaryResult.summaryUptoTimestamp,
                  summaryUpdatedAt: rollingSummaryResult.summaryUpdatedAt,
                  reason: rollingSummaryResult.reason,
                }
              : null,
          },
        },
      );

      let currentToolCallIteration = 0;
      let continueProcessing = true;
      let lastGMIOutput: GMIOutput | undefined; // To store the result from handleToolResult or final processTurnStream result

      while (continueProcessing && currentToolCallIteration < this.config.maxToolCallIterations) {
        currentToolCallIteration++;

        if (lastGMIOutput?.toolCalls && lastGMIOutput.toolCalls.length > 0) {
          // This case should be handled by external call to orchestrateToolResult.
          // If GMI's handleToolResult itself requests more tools *synchronously* in its GMIOutput,
          // the orchestrator needs to initiate those.
          // For now, we assume gmi.processTurnStream is the entry point for a 'thought cycle'.
          // This part of the loop might need to re-evaluate if GMI.handleToolResult directly returns new tool_calls.
          // Based on GMI.ts, handleToolResult calls processTurnStream internally and returns a final GMIOutput for that step.
          // So, we'd take the tool_calls from that GMIOutput and then break this loop to let orchestrateToolResult handle them.
           await this.processGMIOutput(agentOSStreamId, streamContext, lastGMIOutput, true /*isContinuation*/);
            if (lastGMIOutput.toolCalls && lastGMIOutput.toolCalls.length > 0) {
                 // Yield tool call requests and expect external call to orchestrateToolResult
                continueProcessing = false; // Exit this loop, further action via orchestrateToolResult
                break;
            }
            continueProcessing = !lastGMIOutput.isFinal; // isFinal comes from GMIOutput
            if (!continueProcessing) break;
            // If not final and no tool calls, what's the next GMI input? This implies GMI yielded intermediate text.
            // The GMI itself should manage its internal state for continuation.
            // Here we assume processTurnStream will pick up from where it left.
            // For simplicity in this refactor, we'll assume after handleToolResult, if not final & no tools, it's an error or unexpected state.
            // A robust solution might require GMI to provide a continuation token or explicit next step.
            console.warn(`AgentOSOrchestrator: GMI output after tool result was not final and had no tool calls. Ending turn for stream ${agentOSStreamId}.`);
            continueProcessing = false;
            break;
        }

        if (!gmi) {
          throw new Error('AgentOSOrchestrator: GMI not initialized (unexpected).');
        }
        const gmiForTurn = gmi;

        await withAgentOSSpan('agentos.gmi.process_turn_stream', async (span) => {
          span?.setAttribute('agentos.stream_id', agentOSStreamId);
          span?.setAttribute('agentos.gmi_id', gmiInstanceIdForChunks);
          span?.setAttribute('agentos.tool_call_iteration', currentToolCallIteration);

          const gmiStreamIterator = gmiForTurn.processTurnStream(gmiInput); // For initial turn or if GMI internally continues

          // Consume the async generator manually so we can capture its return value (GMIOutput).
          // `for await...of` does not expose the generator return value, which caused placeholder
          // FINAL_RESPONSE payloads (e.g. "Turn processing sequence complete.").
          while (true) {
            const { value, done } = await gmiStreamIterator.next();
            if (done) {
              lastGMIOutput = value;
              continueProcessing = false;
              break;
            }

            const gmiChunk = value;
            await this.transformAndPushGMIChunk(agentOSStreamId, streamContext, gmiChunk);

            // NOTE: Tool calls may be executed internally by the GMI/tool orchestrator. Do not stop
            // streaming on TOOL_CALL_REQUEST; treat it as informational for observers/UI.
            if (gmiChunk.isFinal || gmiChunk.type === GMIOutputChunkType.FINAL_RESPONSE_MARKER) {
              // Still keep consuming to capture the generator's return value.
              continueProcessing = false;
            }
          }
        });
        
        if (!continueProcessing) break; // Exit the while loop
      } // End while

      if (currentToolCallIteration >= this.config.maxToolCallIterations && continueProcessing) {
        console.warn(`AgentOSOrchestrator: Max tool call iterations reached for stream ${agentOSStreamId}. Forcing termination.`);
        didForceTerminate = true;
        await this.pushErrorChunk(
          agentOSStreamId, currentPersonaId, gmiInstanceIdForChunks,
          GMIErrorCode.RATE_LIMIT_EXCEEDED, // Or a more specific code
          'Agent reached maximum tool call iterations.',
          { maxIterations: this.config.maxToolCallIterations }
        );
      }
      
      // Final processing at the end of the turn or if no more continuation.
      // This should use the true GMIOutput returned by GMI (either initial or after tool handling)
      // For now, this relies on the fact that the last interaction with GMI (processTurnStream or handleToolResult)
      // updated the conversation context, and we generate a final response summary.

      // Send a final response chunk if not already implicitly sent by an error or final GMI chunk transform.
      // This part needs careful consideration of what `lastGMIOutput` represents here.
      // It should represent the *actual* TReturn from the GMI's processing.
      const finalGMIStateForResponse: GMIOutput =
        lastGMIOutput ||
        {
          isFinal: true,
          responseText: gmi ? 'Processing complete.' : 'Processing ended.',
        };

      const normalizedUsage = normalizeUsage(finalGMIStateForResponse.usage);
      if (normalizedUsage) {
        turnMetricsUsage = {
          totalTokens: normalizedUsage.totalTokens,
          promptTokens: normalizedUsage.promptTokens,
          completionTokens: normalizedUsage.completionTokens,
          totalCostUSD: typeof normalizedUsage.totalCostUSD === 'number' ? normalizedUsage.totalCostUSD : undefined,
        };
      }
      if (didForceTerminate || Boolean(finalGMIStateForResponse.error)) {
        turnMetricsStatus = 'error';
      }

      // Persist assistant output into ConversationContext for durable memory / prompt reconstruction.
      if (this.config.enableConversationalPersistence && conversationContext) {
        const persistContext = conversationContext;
        try {
          if (typeof finalGMIStateForResponse.responseText === 'string' && finalGMIStateForResponse.responseText.trim()) {
            conversationContext.addMessage({
              role: MessageRole.ASSISTANT,
              content: finalGMIStateForResponse.responseText,
              metadata: { agentPersonaId: currentPersonaId, source: 'agentos_output' },
            });
          } else if (finalGMIStateForResponse.toolCalls && finalGMIStateForResponse.toolCalls.length > 0) {
            conversationContext.addMessage({
              role: MessageRole.ASSISTANT,
              content: null,
              tool_calls: finalGMIStateForResponse.toolCalls as any,
              metadata: { agentPersonaId: currentPersonaId, source: 'agentos_output_tool_calls' },
            });
          }

          await withAgentOSSpan('agentos.conversation.save', async (span) => {
            span?.setAttribute('agentos.stage', 'assistant_output');
            span?.setAttribute('agentos.stream_id', agentOSStreamId);
            await this.dependencies.conversationManager.saveConversation(persistContext);
          });
        } catch (persistError: any) {
          console.warn(
            `AgentOSOrchestrator: Failed to persist assistant output to ConversationContext for stream ${agentOSStreamId}.`,
            persistError,
          );
        }
      }

      await this.pushChunkToStream(
        agentOSStreamId, AgentOSResponseChunkType.FINAL_RESPONSE,
        gmiInstanceIdForChunks, currentPersonaId, true,
        {
          finalResponseText: finalGMIStateForResponse.responseText ?? null,
          finalResponseTextPlain:
            typeof finalGMIStateForResponse.responseText === 'string'
              ? renderPlainText(finalGMIStateForResponse.responseText)
              : null,
          finalToolCalls: finalGMIStateForResponse.toolCalls,
          finalUiCommands: finalGMIStateForResponse.uiCommands,
          audioOutput: finalGMIStateForResponse.audioOutput,
          imageOutput: finalGMIStateForResponse.imageOutput,
          usage: normalizedUsage,
          reasoningTrace: finalGMIStateForResponse.reasoningTrace,
          error: finalGMIStateForResponse.error,
          updatedConversationContext: conversationContext ? conversationContext.toJSON() : undefined,
          activePersonaDetails: snapshotPersonaDetails(gmi?.getPersona?.()),
        }
      );
      await this.dependencies.streamingManager.closeStream(agentOSStreamId, "Processing complete.");

    } catch (error: any) {
      turnMetricsStatus = 'error';
      recordExceptionOnActiveSpan(error, `Error in orchestrateTurn for stream ${agentOSStreamId}`);
      const gmiErr = GMIError.wrap?.(error, GMIErrorCode.GMI_PROCESSING_ERROR, `Error in orchestrateTurn for stream ${agentOSStreamId}`) ||
                     new GMIError(`Error in orchestrateTurn for stream ${agentOSStreamId}: ${error.message}`, GMIErrorCode.GMI_PROCESSING_ERROR, error);
      console.error(`AgentOSOrchestrator: Error during _processTurnInternal for stream ${agentOSStreamId}:`, gmiErr);
      await this.pushErrorChunk(
          agentOSStreamId, currentPersonaId ?? 'unknown_persona', gmiInstanceIdForChunks,
          gmiErr.code, gmiErr.message, gmiErr.details
      );
      await this.dependencies.streamingManager.closeStream(agentOSStreamId, "Error during turn processing.");
    } finally {
      recordAgentOSTurnMetrics({
        durationMs: Date.now() - turnStartedAt,
        status: turnMetricsStatus,
        personaId: turnMetricsPersonaId,
        usage: turnMetricsUsage,
      });

      // Stream is closed explicitly in the success/error paths; this finally block always
      // clears internal state to avoid leaks.
      this.activeStreamContexts.delete(agentOSStreamId);
      console.log(`AgentOSOrchestrator: Finished processing for AgentOS Stream ${agentOSStreamId}. Context removed.`);
    }
  }


  /**
   * Handles the result of an external tool execution, feeding it back into the
   * relevant GMI instance for continued processing.
   * Uses StreamingManager to push subsequent GMI outputs.
   *
   * @public
   * @async
   * @param {string} agentOSStreamId - The orchestrator's stream ID for this interaction flow.
   * @param {string} toolCallId - The ID of the tool call being responded to.
   * @param {string} toolName - The name of the tool.
   * @param {any} toolOutput - The output from the tool.
   * @param {boolean} isSuccess - Whether the tool execution was successful.
   * @param {string} [errorMessage] - Error message if not successful.
   * @returns {Promise<void>}
   * @throws {GMIError} If stream context is not found or GMI fails to handle result.
   */
  public async orchestrateToolResult(
    agentOSStreamId: StreamId,
    toolCallId: string,
    toolName: string,
    toolOutput: any,
    isSuccess: boolean,
    errorMessage?: string,
  ): Promise<void> {
    this.ensureInitialized();

    const startedAt = Date.now();
    const streamContext = this.activeStreamContexts.get(agentOSStreamId);
    if (!streamContext) {
      const errMsg = `Orchestrator: Received tool result for unknown or inactive streamId: ${agentOSStreamId}. Tool: ${toolName}, CallID: ${toolCallId}`;
      console.error(errMsg);
      // Cannot push to a non-existent stream context. This is a critical failure.
      throw new GMIError(errMsg, GMIErrorCode.RESOURCE_NOT_FOUND, { agentOSStreamId, toolCallId });
    }

    const { gmi, userId, personaId, conversationContext, userApiKeys } = streamContext;
    const gmiInstanceIdForChunks = gmi.getGMIId();

    const toolResultPayload: ToolResultPayload = isSuccess
      ? { type: 'success', result: toolOutput }
      : { type: 'error', error: { code: 'EXTERNAL_TOOL_ERROR', message: errorMessage || `External tool '${toolName}' execution failed.` } };

    console.log(`AgentOSOrchestrator: Feeding tool result for stream ${agentOSStreamId}, GMI ${gmiInstanceIdForChunks}, tool call ${toolCallId} (${toolName}) back to GMI.`);

    try {
      await withAgentOSSpan('agentos.tool_result', async (span) => {
        span?.setAttribute('agentos.stream_id', agentOSStreamId);
        span?.setAttribute('agentos.gmi_id', gmiInstanceIdForChunks);
        span?.setAttribute('agentos.tool_call_id', toolCallId);
        span?.setAttribute('agentos.tool_name', toolName);
        span?.setAttribute('agentos.tool_success', isSuccess);

        try {
          // Emit the tool result itself as a chunk
          await this.pushChunkToStream(
            agentOSStreamId,
            AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
            gmiInstanceIdForChunks,
            personaId,
            false,
            { toolCallId, toolName, toolResult: toolOutput, isSuccess, errorMessage },
          );

          // Persist tool result into ConversationContext for durable memory / prompt reconstruction.
          if (this.config.enableConversationalPersistence && conversationContext) {
            try {
              conversationContext.addMessage({
                role: MessageRole.TOOL,
                content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
                tool_call_id: toolCallId,
                name: toolName,
                metadata: { agentPersonaId: personaId, source: 'agentos_tool_result', isSuccess },
              });
              await withAgentOSSpan('agentos.conversation.save', async (child) => {
                child?.setAttribute('agentos.stage', 'tool_result');
                child?.setAttribute('agentos.stream_id', agentOSStreamId);
                await this.dependencies.conversationManager.saveConversation(conversationContext);
              });
            } catch (persistError: any) {
              console.warn(
                `AgentOSOrchestrator: Failed to persist tool result to ConversationContext for stream ${agentOSStreamId}.`,
                persistError,
              );
            }
          }

          // GMI processes the tool result and gives a *final output for that step*
          const gmiOutputAfterTool: GMIOutput = await withAgentOSSpan(
            'agentos.gmi.handle_tool_result',
            async (child) => {
              child?.setAttribute('agentos.stream_id', agentOSStreamId);
              child?.setAttribute('agentos.tool_call_id', toolCallId);
              child?.setAttribute('agentos.tool_name', toolName);
              child?.setAttribute('agentos.tool_success', isSuccess);
              return gmi.handleToolResult(
                toolCallId,
                toolName,
                toolResultPayload,
                userId,
                userApiKeys || {},
              );
            },
          );

          // Process the GMIOutput (which is not a stream of chunks)
          await this.processGMIOutput(agentOSStreamId, streamContext, gmiOutputAfterTool, false);

          // If GMIOutput indicates further tool calls are needed by the GMI
          if (gmiOutputAfterTool.toolCalls && gmiOutputAfterTool.toolCalls.length > 0) {
            await this.pushChunkToStream(
              agentOSStreamId,
              AgentOSResponseChunkType.TOOL_CALL_REQUEST,
              gmiInstanceIdForChunks,
              personaId,
              false, // Not final, more interaction expected
              {
                toolCalls: gmiOutputAfterTool.toolCalls,
                rationale: gmiOutputAfterTool.responseText || 'Agent requires further tool execution.',
              },
            );
            // The orchestrator now waits for another external call to `orchestrateToolResult` for these new calls.
          } else if (gmiOutputAfterTool.isFinal) {
            if (this.config.enableConversationalPersistence && conversationContext) {
              try {
                if (
                  typeof gmiOutputAfterTool.responseText === 'string' &&
                  gmiOutputAfterTool.responseText.trim()
                ) {
                  conversationContext.addMessage({
                    role: MessageRole.ASSISTANT,
                    content: gmiOutputAfterTool.responseText,
                    metadata: { agentPersonaId: personaId, source: 'agentos_output' },
                  });
                } else if (gmiOutputAfterTool.toolCalls && gmiOutputAfterTool.toolCalls.length > 0) {
                  conversationContext.addMessage({
                    role: MessageRole.ASSISTANT,
                    content: null,
                    tool_calls: gmiOutputAfterTool.toolCalls as any,
                    metadata: { agentPersonaId: personaId, source: 'agentos_output_tool_calls' },
                  });
                }
                await withAgentOSSpan('agentos.conversation.save', async (child) => {
                  child?.setAttribute('agentos.stage', 'assistant_output_after_tool');
                  child?.setAttribute('agentos.stream_id', agentOSStreamId);
                  await this.dependencies.conversationManager.saveConversation(conversationContext);
                });
              } catch (persistError: any) {
                console.warn(
                  `AgentOSOrchestrator: Failed to persist assistant output after tool result for stream ${agentOSStreamId}.`,
                  persistError,
                );
              }
            }
            // If it's final and no more tool calls, the interaction for this GMI processing cycle might be done.
            // Push a final response marker or the already pushed final data from processGMIOutput takes precedence.
            await this.pushChunkToStream(
              agentOSStreamId,
              AgentOSResponseChunkType.FINAL_RESPONSE,
              gmiInstanceIdForChunks,
              personaId,
              true,
              {
                finalResponseText: gmiOutputAfterTool.responseText,
                finalToolCalls: gmiOutputAfterTool.toolCalls,
                finalUiCommands: gmiOutputAfterTool.uiCommands,
                audioOutput: gmiOutputAfterTool.audioOutput,
                imageOutput: gmiOutputAfterTool.imageOutput,
                usage: normalizeUsage(gmiOutputAfterTool.usage),
                reasoningTrace: gmiOutputAfterTool.reasoningTrace,
                error: gmiOutputAfterTool.error,
                updatedConversationContext: conversationContext.toJSON(),
                activePersonaDetails: snapshotPersonaDetails(gmi.getPersona?.()),
              },
            );
            this.activeStreamContexts.delete(agentOSStreamId); // Clean up context for this completed flow
            await this.dependencies.streamingManager.closeStream(
              agentOSStreamId,
              'Tool processing complete and final response generated.',
            );
          }
          // If not final and no tool calls, the GMI might have provided intermediate text.
          // The stream remains open for further GMI internal processing or new user input.
        } catch (error: any) {
          const gmiErr =
            GMIError.wrap?.(
              error,
              GMIErrorCode.TOOL_ERROR,
              `Error in orchestrateToolResult for stream ${agentOSStreamId}`,
            ) ||
            new GMIError(
              `Error in orchestrateToolResult for stream ${agentOSStreamId}: ${error.message}`,
              GMIErrorCode.TOOL_ERROR,
              error,
            );
          console.error(
            `AgentOSOrchestrator: Critical error processing tool result for stream ${agentOSStreamId}:`,
            gmiErr,
          );
          await this.pushErrorChunk(
            agentOSStreamId,
            personaId,
            gmiInstanceIdForChunks,
            gmiErr.code,
            gmiErr.message,
            gmiErr.details,
          );
          this.activeStreamContexts.delete(agentOSStreamId);
          await this.dependencies.streamingManager.closeStream(
            agentOSStreamId,
            'Critical error during tool result processing.',
          );
          throw gmiErr; // Re-throw to signal failure to caller if necessary
        }
      });

      recordAgentOSToolResultMetrics({
        durationMs: Date.now() - startedAt,
        status: 'ok',
        toolName,
        toolSuccess: isSuccess,
      });
    } catch (error) {
      recordAgentOSToolResultMetrics({
        durationMs: Date.now() - startedAt,
        status: 'error',
        toolName,
        toolSuccess: isSuccess,
      });
      throw error;
    }
  }
  
  /**
   * Processes a GMIOutput object (typically from handleToolResult or the end of a processTurnStream)
   * and pushes relevant chunks to the client stream.
   * @private
   */
  private async processGMIOutput(
      agentOSStreamId: string,
      streamContext: ActiveStreamContext,
      gmiOutput: GMIOutput,
      _isContinuation: boolean // True if this GMIOutput is from an internal GMI continuation, false if from initial turn/tool result
  ): Promise<void> {
      const { gmi, personaId, conversationContext } = streamContext;
      const gmiInstanceIdForChunks = gmi.getGMIId();

      if (gmiOutput.responseText) {
          await this.pushChunkToStream(
              agentOSStreamId, AgentOSResponseChunkType.TEXT_DELTA,
              gmiInstanceIdForChunks, personaId, false, // text delta is not final by itself
              { textDelta: gmiOutput.responseText }
          );
      }
      if (gmiOutput.uiCommands && gmiOutput.uiCommands.length > 0) {
          await this.pushChunkToStream(
              agentOSStreamId, AgentOSResponseChunkType.UI_COMMAND,
              gmiInstanceIdForChunks, personaId, false,
              { uiCommands: gmiOutput.uiCommands }
          );
      }
      if (gmiOutput.error) {
          await this.pushErrorChunk(
              agentOSStreamId, personaId, gmiInstanceIdForChunks,
              gmiOutput.error.code, gmiOutput.error.message, gmiOutput.error.details
          );
          // If an error occurs in GMIOutput, it's usually final for this interaction path
          if (gmiOutput.isFinal) {
              this.activeStreamContexts.delete(agentOSStreamId);
              await this.dependencies.streamingManager.closeStream(agentOSStreamId, `GMI reported an error: ${gmiOutput.error.message}`);
          }
          return; // Stop further processing of this GMIOutput if there's an error
      }

      // Note: Tool calls from GMIOutput are handled by the calling method (orchestrateTurn or orchestrateToolResult)
      // to decide on looping or yielding ToolCallRequestChunks.

      if (gmiOutput.isFinal && (!gmiOutput.toolCalls || gmiOutput.toolCalls.length === 0)) {
           if (this.config.enableConversationalPersistence && conversationContext) {
              await withAgentOSSpan('agentos.conversation.save', async (span) => {
                span?.setAttribute('agentos.stage', 'gmi_output_final');
                span?.setAttribute('agentos.stream_id', agentOSStreamId);
                await this.dependencies.conversationManager.saveConversation(conversationContext);
              });
           }
          // This is a final response without further tool calls
          await this.pushChunkToStream(
              agentOSStreamId, AgentOSResponseChunkType.FINAL_RESPONSE,
              gmiInstanceIdForChunks, personaId, true,
              {
                  finalResponseText: gmiOutput.responseText,
                  finalToolCalls: gmiOutput.toolCalls, // Should be empty or undefined here
                  finalUiCommands: gmiOutput.uiCommands,
                  audioOutput: gmiOutput.audioOutput,
                  imageOutput: gmiOutput.imageOutput,
                  usage: normalizeUsage(gmiOutput.usage),
                  reasoningTrace: gmiOutput.reasoningTrace,
                  error: gmiOutput.error, // Should be undefined here if we reached this point
                  updatedConversationContext: conversationContext.toJSON(),
                  activePersonaDetails: snapshotPersonaDetails(gmi.getPersona?.()),
              }
          );
          this.activeStreamContexts.delete(agentOSStreamId);
          await this.dependencies.streamingManager.closeStream(agentOSStreamId, "Processing complete.");
      }
  }

  /**
   * Transforms a GMIOutputChunk into one or more AgentOSResponse chunks and pushes them.
   * @private
   */
  private async transformAndPushGMIChunk(
    agentOSStreamId: string,
    streamContext: ActiveStreamContext,
    gmiChunk: GMIOutputChunk
  ): Promise<void> {
    const { gmi, personaId, conversationContext } = streamContext;
    const gmiInstanceIdForChunks = gmi.getGMIId();

    switch (gmiChunk.type) {
      case GMIOutputChunkType.TEXT_DELTA:
        if (gmiChunk.content && typeof gmiChunk.content === 'string') {
          await this.pushChunkToStream(
            agentOSStreamId, AgentOSResponseChunkType.TEXT_DELTA,
            gmiInstanceIdForChunks, personaId, gmiChunk.isFinal ?? false,
            { textDelta: gmiChunk.content }
          );
        }
        break;
      case GMIOutputChunkType.SYSTEM_MESSAGE: // Was SystemProgress
        if (gmiChunk.content && typeof gmiChunk.content === 'object') {
          const progressContent = gmiChunk.content as { message: string; progressPercentage?: number; statusCode?: string };
          await this.pushChunkToStream(
            agentOSStreamId, AgentOSResponseChunkType.SYSTEM_PROGRESS,
            gmiInstanceIdForChunks, personaId, gmiChunk.isFinal ?? false,
            progressContent
          );
        }
        break;
      case GMIOutputChunkType.TOOL_CALL_REQUEST:
        if (gmiChunk.content && Array.isArray(gmiChunk.content)) {
          const toolCalls = gmiChunk.content as ToolCallRequest[];
          await this.pushChunkToStream(
            agentOSStreamId, AgentOSResponseChunkType.TOOL_CALL_REQUEST,
            gmiInstanceIdForChunks, personaId, false, // Tool call request is not final for the AgentOS turn
            { toolCalls, rationale: gmiChunk.metadata?.rationale || "Agent requires tool execution." }
          );
        }
        break;
      case GMIOutputChunkType.UI_COMMAND:
        if (gmiChunk.content && Array.isArray(gmiChunk.content)) {
          await this.pushChunkToStream(
            agentOSStreamId, AgentOSResponseChunkType.UI_COMMAND,
            gmiInstanceIdForChunks, personaId, gmiChunk.isFinal ?? false,
            { uiCommands: gmiChunk.content as UICommand[] }
          );
        }
        break;
      case GMIOutputChunkType.ERROR: {
        const errDetails = gmiChunk.errorDetails || { message: gmiChunk.content };
        await this.pushErrorChunk(
          agentOSStreamId, personaId, gmiInstanceIdForChunks,
          errDetails.code || GMIErrorCode.GMI_PROCESSING_ERROR,
          errDetails.message || String(gmiChunk.content) || 'Unknown GMI processing error.',
          errDetails.details || errDetails
        );
        // If GMI sends an error chunk that it considers final for its operation
        if (gmiChunk.isFinal) {
          this.activeStreamContexts.delete(agentOSStreamId);
          await this.dependencies.streamingManager.closeStream(agentOSStreamId, `GMI stream error: ${errDetails.message || String(gmiChunk.content)}`);
        }
        break;
      }
      case GMIOutputChunkType.FINAL_RESPONSE_MARKER:
        // Marker chunk emitted at end-of-stream. Do not surface to clients as a response.
        // The real final response is the AsyncGenerator return value (GMIOutput), handled by _processTurnInternal.
        break;
      case GMIOutputChunkType.USAGE_UPDATE:
        // TODO: Could send a specific AgentOSMetadataUpdateChunk if defined, or log.
        console.log(`AgentOSOrchestrator: UsageUpdate from GMI on stream ${agentOSStreamId}:`, gmiChunk.content);
        break;
      default:
        console.warn(`AgentOSOrchestrator: Unhandled GMIOutputChunkType '${gmiChunk.type}' on stream ${agentOSStreamId}. Content:`, gmiChunk.content);
    }
  }
  
  /**
   * Constructs GMITurnInput from AgentOSInput.
   * @private
   */
  private constructGMITurnInput(agentOSStreamId: string, input: AgentOSInput, streamContext: ActiveStreamContext): GMITurnInput {
    const { userId, sessionId, options } = input;
    const { gmi } = streamContext;

    const gmiInputMetadata: Record<string, any> = {
        gmiId: gmi.getGMIId(),
        // Pass relevant options to GMI if it needs them
        options: options,
        // User API keys are handled by GMIManager when fetching/creating GMI,
        // but can be passed in metadata if GMI needs them per-turn for some reason.
        userApiKeys: input.userApiKeys,
        userFeedback: input.userFeedback,
        explicitPersonaSwitchId: input.selectedPersonaId,
        // Task hint can be more sophisticated, based on input analysis
        taskHint: input.textInput ? 'user_text_query' : (input.visionInputs || input.audioInput) ? 'user_multimodal_query' : 'general_query',
        // GMI.ts specific fields if any, not standard in IGMI.GMITurnInput
        modelSelectionOverrides: {
            preferredModelId: options?.preferredModelId,
            preferredProviderId: options?.preferredProviderId,
            temperature: options?.temperature,
            topP: options?.topP,
            maxTokens: options?.maxTokens,
        },
        personaStateOverrides: [], // Example
    };

    let type: GMIInteractionType;
    let content: GMITurnInput['content'];

    if (input.visionInputs && input.visionInputs.length > 0 || input.audioInput) {
        type = GMIInteractionType.MULTIMODAL_CONTENT;
        const multiModalContent: {text?: string | null, vision?: any[], audio?: any} = {};
        if (input.textInput) multiModalContent.text = input.textInput;
        if (input.visionInputs) multiModalContent.vision = input.visionInputs;
        if (input.audioInput) multiModalContent.audio = input.audioInput;
        content = multiModalContent;
    } else if (input.textInput) {
        type = GMIInteractionType.TEXT;
        content = input.textInput;
    } else {
        // Fallback or error if no meaningful input
        type = GMIInteractionType.SYSTEM_MESSAGE; // E.g. an empty ping or keep-alive
        content = "No primary user input provided for this turn.";
        console.warn(`AgentOSOrchestrator: No primary input in AgentOSInput for stream ${agentOSStreamId}. Sending as system message to GMI.`);
    }

    return {
        interactionId: agentOSStreamId + `_turn_${uuidv4()}`, // More specific interaction ID for GMI
        userId,
        sessionId, // AgentOS session ID
        type,
        content,
        metadata: gmiInputMetadata,
        timestamp: new Date(),
    };
  }

  /**
   * Shuts down the AgentOSOrchestrator.
   * Currently, this mainly involves clearing active stream contexts.
   * Dependencies like GMIManager are assumed to be shut down by AgentOS.
   *
   * @public
   * @async
   * @returns {Promise<void>} A promise that resolves when shutdown is complete.
   */
  public async shutdown(): Promise<void> {
    console.log('AgentOSOrchestrator: Shutting down...');
    // Notify and close streams managed by StreamingManager for contexts held here
    for (const streamId of this.activeStreamContexts.keys()) {
        try {
            await this.dependencies.streamingManager.closeStream(streamId, "Orchestrator shutting down.");
        } catch (e:any) {
            console.error(`AgentOSOrchestrator: Error closing stream ${streamId} during shutdown: ${e.message}`);
        }
    }
    this.activeStreamContexts.clear();
    this.initialized = false;
    console.log('AgentOSOrchestrator: Shutdown complete.');
  }
}
