// File: backend/agentos/core/orchestration/AgentOrchestrator.ts
/**
 * @fileoverview Implements the `AgentOSOrchestrator` class, the central nervous system for AgentOS interactions.
 * This module is responsible for the intricate coordination between the public-facing `AgentOS` API
 * and the cognitive core, the `GMI` (Generalized Mind Instance). It meticulously manages the
 * entire lifecycle of an interaction turn.
 *
 * Key Responsibilities:
 * - **GMI Instance Management**: Selection/creation of GMI instances via `GMIManager`.
 * - **Contextualization**: Preparation and loading of `ConversationContext`.
 * - **Input Processing**: Transformation of `AgentOSInput` into `GMITurnInput`.
 * - **Streaming Output Handling**: Iteration over `GMIOutputChunk` streams from the GMI.
 * - **Tool Use Coordination**:
 * - Relaying `ToolCallRequest`s to the client (via `StreamingManager`).
 * - Receiving tool execution results.
 * - Forwarding tool results back to the GMI via `handleToolResult`.
 * - Processing the GMI's response (`GMIOutput`) post-tool execution.
 * - **Response Streaming**: Conversion of GMI outputs into `AgentOSResponse` chunks and their
 * distribution through the `StreamingManager`.
 * - **State Management**: Tracking active interaction streams and their associated contexts.
 * - **Error Handling**: Robust error management for orchestration failures.
 *
 * The orchestrator embodies asynchronous processing and streaming, ensuring a responsive user experience.
 * It relies on dependency injection for its core components, promoting modularity and testability.
 *
 * @module backend/agentos/core/orchestration/AgentOSOrchestrator
 */

import { AgentOSInput, ProcessingOptions, UserFeedbackPayload } from '../../api/types/AgentOSInput';
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
  AgentOSAgencyUpdateChunk,
} from '../../api/types/AgentOSResponse';
import { GMIManager } from '../../cognitive_substrate/GMIManager';
import {
  IGMI,
  GMITurnInput,
  GMIOutputChunk,
  GMIOutput,
  ToolCallRequest, // Explicitly import ToolCallRequest
  ToolResultPayload,
  GMIInteractionType,
  GMIOutputChunkType,
  UICommand,
  AudioOutputConfig,
  ImageOutputConfig,
  CostAggregator,
  ReasoningTraceEntry,
  VisionInputData,
  AudioInputData,
} from '../../cognitive_substrate/IGMI';
import { ConversationManager } from '../conversation/ConversationManager';
import { ConversationContext } from '../conversation/ConversationContext';
import { ToolOrchestrator as ConcreteToolOrchestrator } from '../tools/ToolOrchestrator';
// import { ITool } from '../tools/ITool'; // ITool not directly used here, but good to keep if planned
import { MessageRole } from '../conversation/ConversationMessage';
import type { ConversationMessage } from '../conversation/ConversationMessage';
import { v4 as uuidv4 } from 'uuid';
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '@agentos/core/utils/errors';
import { IPersonaDefinition } from '../../cognitive_substrate/personas/IPersonaDefinition';
import { StreamingManager, StreamId } from '../streaming/StreamingManager';
import { normalizeUsage, snapshotPersonaDetails } from './helpers';

/**
 * Configuration options for the AgentOSOrchestrator.
 * These settings govern the behavior and limits of the orchestration process.
 * @interface AgentOSOrchestratorConfig
 */
export interface AgentOSOrchestratorConfig {
  /**
   * The maximum number of sequential tool call iterations allowed within a single logical turn.
   * This prevents potential infinite loops if GMIs repeatedly call tools without resolution.
   * @type {number}
   * @default 5
   */
  maxToolCallIterations?: number;

  /**
   * Default timeout in milliseconds for a single GMI processing step
   * (e.g., initial turn or processing after a tool result).
   * Note: Actual timeout implementation might reside within the GMI or LLM provider layer.
   * @type {number}
   * @default 120000 (2 minutes)
   */
  defaultAgentTurnTimeoutMs?: number;

  /**
   * If true, conversation context will be persistently saved and loaded by the `ConversationManager`.
   * If false, conversations are primarily in-memory, and their persistence depends on the
   * `ConversationManager`'s specific configuration.
   * @type {boolean}
   * @default true
   */
  enableConversationalPersistence?: boolean;
  /** If true, orchestrator logs detailed information about tool calls. */
  logToolCalls?: boolean;
}

/**
 * Defines the dependencies required by the AgentOSOrchestrator for its operation.
 * These services are typically injected during the orchestrator's initialization phase,
 * adhering to the Dependency Inversion Principle.
 * @interface AgentOSOrchestratorDependencies
 */
export interface AgentOSOrchestratorDependencies {
  /** An instance of GMIManager for managing GMI instances and persona definitions. */
  gmiManager: GMIManager;
  /** An instance of ToolOrchestrator for orchestrating the execution of tools. */
  toolOrchestrator: ConcreteToolOrchestrator;
  /** An instance of ConversationManager for managing conversation contexts. */
  conversationManager: ConversationManager;
  /** An instance of StreamingManager for managing streaming responses to clients. */
  streamingManager: StreamingManager;
}

/**
 * Internal state for managing an active stream of GMI interaction, associated with an `agentOSStreamId`.
 * This context bundles all necessary information and instances for processing a single user interaction flow.
 * @interface ActiveStreamContext
 * @private
 */
interface ActiveStreamContext {
  /** The active GMI instance for this stream. */
  gmi: IGMI;
  /** The ID of the user initiating the interaction. */
  userId: string;
  /** The AgentOS session ID for this interaction. */
  sessionId: string;
  /** The ID of the currently active persona in the GMI. */
  personaId: string;
  /** The specific ID of the conversation context being used. */
  conversationId: string;
  /** The live conversation context object. */
  conversationContext: ConversationContext;
  /** Optional user-provided API keys for external services. */
  userApiKeys?: Record<string, string>;
  /** Optional processing options for the current turn. */
  processingOptions?: ProcessingOptions;
}

/**
 * @class AgentOSOrchestrator
 * @classdesc
 * The `AgentOSOrchestrator` serves as the master conductor of interactions within the AgentOS platform.
 * It is the critical intermediary layer that bridges high-level API requests (`AgentOSInput`)
 * with the sophisticated cognitive processing of Generalized Mind Instances (`IGMI`).
 * Its primary function is to manage the entire lifecycle of a user's interaction turn, a potentially
 * complex, multi-step process.
 */
export class AgentOSOrchestrator {
  private initialized: boolean = false;
  private config!: Readonly<Required<AgentOSOrchestratorConfig>>;
  private dependencies!: Readonly<AgentOSOrchestratorDependencies>;
  
  /**
   * Stores the context for active, ongoing interaction streams.
   * The key is the `agentOSStreamId` generated by this orchestrator.
   * @private
   * @type {Map<StreamId, ActiveStreamContext>}
   */
  private readonly activeStreamContexts: Map<StreamId, ActiveStreamContext>;

  /**
   * Constructs an AgentOSOrchestrator instance.
   * The orchestrator is not operational until `initialize()` is successfully called.
   */
  constructor() {
    this.activeStreamContexts = new Map();
  }

  /**
   * Initializes the AgentOSOrchestrator with its configuration and essential service dependencies.
   * This method must be called and resolve successfully before the orchestrator can process any requests.
   * It sets up the orchestrator's internal state and validates its dependencies.
   *
   * @public
   * @async
   * @param {AgentOSOrchestratorConfig} config - Configuration settings for the orchestrator.
   * @param {AgentOSOrchestratorDependencies} dependencies - An object containing instances of required services.
   * @returns {Promise<void>} A Promise that resolves when initialization is complete.
   * @throws {GMIError} If critical dependencies are missing (GMIErrorCode.CONFIGURATION_ERROR).
   */
  public async initialize(
    config: AgentOSOrchestratorConfig,
    dependencies: AgentOSOrchestratorDependencies,
  ): Promise<void> {
    if (this.initialized) {
      console.warn('AgentOSOrchestrator: Instance is already initialized. Skipping re-initialization.');
      return;
    }

    if (!dependencies.gmiManager || !dependencies.toolOrchestrator || !dependencies.conversationManager || !dependencies.streamingManager) {
      const missingDeps = [
        !dependencies.gmiManager && "gmiManager",
        !dependencies.toolOrchestrator && "toolOrchestrator",
        !dependencies.conversationManager && "conversationManager",
        !dependencies.streamingManager && "streamingManager",
      ].filter(Boolean).join(', ');
      throw new GMIError(
        `AgentOSOrchestrator: Initialization failed due to missing essential dependencies: ${missingDeps}.`,
        GMIErrorCode.CONFIGURATION_ERROR,
        { missingDependencies: missingDeps }
      );
    }

    this.config = Object.freeze({
      maxToolCallIterations: config.maxToolCallIterations ?? 5,
      defaultAgentTurnTimeoutMs: config.defaultAgentTurnTimeoutMs ?? 120000,
      enableConversationalPersistence: config.enableConversationalPersistence ?? true,
      logToolCalls: config.logToolCalls ?? false,
    });
    this.dependencies = Object.freeze(dependencies);
    this.initialized = true;
    console.log(`AgentOSOrchestrator initialized successfully. Configuration: ${JSON.stringify(this.config)}`);
  }

  /**
   * Ensures that the orchestrator has been initialized before performing operations.
   * @private
   * @throws {GMIError} If the orchestrator is not initialized (GMIErrorCode.NOT_INITIALIZED).
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new GMIError(
        'AgentOSOrchestrator is not initialized. Please call the initialize() method first.',
        GMIErrorCode.NOT_INITIALIZED,
        { component: 'AgentOSOrchestrator' }
      );
    }
  }

  /**
   * Pushes a response chunk to the client via the StreamingManager.
   * This is a centralized helper for all chunk types.
   * @private
   * @param {StreamId} agentOSStreamId - The unique ID of the AgentOS stream.
   * @param {AgentOSResponseChunkType} type - The type of chunk being pushed.
   * @param {string} gmiInstanceId - The ID of the GMI instance generating this chunk.
   * @param {string} personaId - The ID of the persona active during this chunk's generation.
   * @param {boolean} isFinal - Whether this chunk marks the end of the response for this stream.
   * @param {any} data - The specific payload data for the chunk, varying by `type`.
   * @returns {Promise<void>}
   */
  private async pushChunkToStream(
    agentOSStreamId: StreamId,
    type: AgentOSResponseChunkType,
    gmiInstanceId: string,
    personaId: string, // This is now consistently a string
    isFinal: boolean,
    data: any
  ): Promise<void> {
    const baseChunk = { type, streamId: agentOSStreamId, gmiInstanceId, personaId, isFinal, timestamp: new Date().toISOString() };
    let chunk: AgentOSResponse;

    switch (type) {
      case AgentOSResponseChunkType.TEXT_DELTA:
        chunk = { ...baseChunk, textDelta: data.textDelta } as AgentOSTextDeltaChunk;
        break;
      case AgentOSResponseChunkType.SYSTEM_PROGRESS:
        chunk = { ...baseChunk, message: data.message, progressPercentage: data.progressPercentage, statusCode: data.statusCode } as AgentOSSystemProgressChunk;
        break;
      case AgentOSResponseChunkType.TOOL_CALL_REQUEST:
        chunk = { ...baseChunk, toolCalls: data.toolCalls, rationale: data.rationale } as AgentOSToolCallRequestChunk;
        break;
      case AgentOSResponseChunkType.TOOL_RESULT_EMISSION:
        chunk = { ...baseChunk, toolCallId: data.toolCallId, toolName: data.toolName, toolResult: data.toolResult, isSuccess: data.isSuccess, errorMessage: data.errorMessage } as AgentOSToolResultEmissionChunk;
        break;
      case AgentOSResponseChunkType.UI_COMMAND:
        chunk = { ...baseChunk, uiCommands: data.uiCommands } as AgentOSUICommandChunk;
        break;
      case AgentOSResponseChunkType.ERROR:
        chunk = { ...baseChunk, code: data.code, message: data.message, details: data.details } as AgentOSErrorChunk;
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
          activePersonaDetails: data.activePersonaDetails
        } as AgentOSFinalResponseChunk;
        break;
      case AgentOSResponseChunkType.METADATA_UPDATE:
        chunk = { ...baseChunk, updates: data.updates } as AgentOSMetadataUpdateChunk;
        break;
      case AgentOSResponseChunkType.WORKFLOW_UPDATE:
        chunk = { ...baseChunk, workflow: data.workflow } as AgentOSWorkflowUpdateChunk;
        break;
      case AgentOSResponseChunkType.AGENCY_UPDATE:
        chunk = { ...baseChunk, agency: data.agency } as AgentOSAgencyUpdateChunk;
        break;
      default:
        const exhaustiveCheck: never = type;
        const errorMsg = `Internal Error: Unknown stream chunk type '${exhaustiveCheck as string}' encountered by orchestrator.`;
        console.error(`AgentOSOrchestrator: ${errorMsg}`);
        chunk = { 
          ...baseChunk, 
          type: AgentOSResponseChunkType.ERROR, 
          code: GMIErrorCode.INTERNAL_SERVER_ERROR.toString(), 
          message: errorMsg,
          details: { originalData: data, originalType: type as string }
        } as AgentOSErrorChunk;
    }
    try {
      await this.dependencies.streamingManager.pushChunk(agentOSStreamId, chunk);
    } catch (pushError: any) {
      console.error(`AgentOSOrchestrator: Failed to push chunk to stream ${agentOSStreamId}. Type: ${type}. Error: ${pushError.message}`, pushError);
    }
  }

  /**
   * Pushes a standardized error chunk to the client.
   * @private
   * @param {StreamId} agentOSStreamId - The ID of the AgentOS stream.
   * @param {string} personaId - The ID of the persona associated with this error.
   * @param {string} [gmiInstanceId='unknown_gmi_instance'] - The ID of the GMI instance.
   * @param {GMIErrorCode | string} code - The error code.
   * @param {string} message - The error message.
   * @param {any} [details] - Additional error details.
   * @returns {Promise<void>}
   */
  private async pushErrorChunk(
    agentOSStreamId: StreamId,
    personaId: string, // Ensured to be string by callers
    gmiInstanceId: string = 'unknown_gmi_instance',
    code: GMIErrorCode | string,
    message: string,
    details?: any
  ): Promise<void> {
    await this.pushChunkToStream(
      agentOSStreamId, AgentOSResponseChunkType.ERROR,
      gmiInstanceId, personaId, true, 
      { code: code.toString(), message, details }
    );
  }
  
  /**
   * Orchestrates a complete user interaction turn, starting from an `AgentOSInput`.
   * This method initiates a new stream for the interaction via `StreamingManager`,
   * then delegates the complex, potentially long-running processing to `_processTurnInternal`
   * without awaiting its completion. This allows `orchestrateTurn` to return the `StreamId`
   * to the caller (e.g., `AgentOS` facade) immediately, enabling clients to subscribe to the
   * stream for real-time updates.
   *
   * @public
   * @async
   * @param {AgentOSInput} input - The comprehensive input for the current turn from the API layer.
   * @returns {Promise<StreamId>} The unique ID of the stream established for this interaction.
   * Clients should use this ID to listen for `AgentOSResponse` chunks.
   * @throws {GMIError} If the `StreamingManager` fails to create a new stream (e.g., `GMIErrorCode.STREAM_ERROR`).
   */
  public async orchestrateTurn(input: AgentOSInput): Promise<StreamId> {
    this.ensureInitialized();
    const baseStreamId = input.sessionId ? `agentos-session-${input.sessionId}` : `agentos-turn-${uuidv4()}`;
    const agentOSStreamId = await this.dependencies.streamingManager.createStream(baseStreamId);
    
    console.log(`AgentOSOrchestrator: Orchestrating new turn. AgentOS Stream ID: ${agentOSStreamId}, User: ${input.userId}, Input Session: ${input.sessionId}`);

    this._processTurnInternal(agentOSStreamId, input).catch(async (criticalError: any) => {
      console.error(`AgentOSOrchestrator: CRITICAL UNHANDLED error from _processTurnInternal initiation for stream ${agentOSStreamId}:`, criticalError);
      const streamContext = this.activeStreamContexts.get(agentOSStreamId);
      const personaIdForError = input.selectedPersonaId || streamContext?.personaId || 'unknown_critical_error_persona';
      const gmiInstanceIdForError = streamContext?.gmi?.getGMIId() || 'orchestrator_pre_gmi_critical_error'; 
      try {
        await this.pushErrorChunk(
          agentOSStreamId, personaIdForError, gmiInstanceIdForError,
          GMIErrorCode.INTERNAL_SERVER_ERROR,
          `A critical unrecoverable orchestration error occurred: ${criticalError.message}`,
          { errorName: criticalError.name, rawErrorString: String(criticalError), stack: criticalError.stack }
        );
        if (this.activeStreamContexts.has(agentOSStreamId)) {
            // TS2554 fix: Pass only 1 or 2 arguments
          await this.dependencies.streamingManager.closeStream(agentOSStreamId, "Critical orchestrator error during turn processing initiation."); 
        }
      } catch (cleanupError: any) {
        console.error(`AgentOSOrchestrator: Error during critical error cleanup messaging for stream ${agentOSStreamId}:`, cleanupError);
      }
      this.activeStreamContexts.delete(agentOSStreamId);
    });

    return agentOSStreamId;
  }
  
  /**
   * Constructs a `GMITurnInput` object from the API-level `AgentOSInput`.
   * This method maps and transforms data to the structure expected by the `IGMI`.
   *
   * @private
   * @param {StreamId} agentOSStreamId - The orchestrator-level stream ID, used to generate a GMI interaction ID.
   * @param {AgentOSInput} agentOSInput - The input received from the AgentOS API layer.
   * @param {string} activePersonaId - The definitive ID of the persona resolved for this turn. Guaranteed to be a string by caller.
   * @returns {GMITurnInput} The structured input object ready for the GMI.
   */
  private constructGMITurnInput(agentOSStreamId: StreamId, agentOSInput: AgentOSInput, activePersonaId: string): GMITurnInput { // activePersonaId is string
    const { userId, sessionId, options, textInput, visionInputs, audioInput, userFeedback, selectedPersonaId, userApiKeys } = agentOSInput;

    const gmiInputMetadata: GMITurnInput['metadata'] = {
      options: {
        ...(options || {}),
        preferredModelId: options?.preferredModelId,
        preferredProviderId: options?.preferredProviderId,
        temperature: options?.temperature,
        topP: options?.topP,
        maxTokens: options?.maxTokens,
        toolChoice: (options as any)?.toolChoice, 
        responseFormat: (options as any)?.responseFormat,
      },
      userApiKeys,
      userFeedback,
      explicitPersonaSwitchId: selectedPersonaId !== activePersonaId ? selectedPersonaId : undefined,
      taskHint: '', 
    };

    let type: GMIInteractionType;
    let content: GMITurnInput['content'];

    if ((visionInputs && visionInputs.length > 0) || audioInput) {
      type = GMIInteractionType.MULTIMODAL_CONTENT;
      const multiModalPayload: { text?: string | null; vision?: VisionInputData[]; audio?: AudioInputData } = {};
      if (textInput !== null && textInput !== undefined) multiModalPayload.text = textInput;
      if (visionInputs) multiModalPayload.vision = visionInputs;
      if (audioInput) multiModalPayload.audio = audioInput;
      content = multiModalPayload;
      if (gmiInputMetadata) gmiInputMetadata.taskHint = textInput ? 'user_multimodal_query_with_text' : (visionInputs && visionInputs.length > 0 && audioInput) ? 'user_visual_audio_query' : (visionInputs && visionInputs.length > 0) ? 'user_visual_query' : 'user_audio_query';
    } else if (textInput !== null && textInput !== undefined && textInput.trim() !== '') {
      type = GMIInteractionType.TEXT;
      content = textInput;
      if (gmiInputMetadata) gmiInputMetadata.taskHint = 'user_text_query';
    } else if (userFeedback) {
      type = GMIInteractionType.SYSTEM_MESSAGE;
      content = { type: 'feedback_provided', payload: userFeedback };
      if (gmiInputMetadata) gmiInputMetadata.taskHint = 'user_feedback_submission';
    } else {
      type = GMIInteractionType.SYSTEM_MESSAGE;
      content = "System: Orchestrator initiating turn with no direct textual, visual, or audio input from user.";
      if (gmiInputMetadata) gmiInputMetadata.taskHint = 'system_initiated_turn_or_ping';
      console.warn(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): No primary user input. Classifying as system message.`);
    }
    
    return {
      interactionId: `${agentOSStreamId}_gmi_turn_${uuidv4()}`,
      userId,
      sessionId: sessionId || agentOSStreamId,
      type,
      content,
      metadata: gmiInputMetadata,
      timestamp: new Date(),
    };
  }

  /**
   * Core internal turn processing logic. This method is executed asynchronously by `orchestrateTurn`.
   * It manages the GMI interaction loop, including streaming chunks, handling tool call requests,
   * and ensuring finalization of the stream.
   *
   * @private
   * @async
   * @param {StreamId} agentOSStreamId - The unique ID for this AgentOS-level stream.
   * @param {AgentOSInput} input - The initial input for this turn.
   * @returns {Promise<void>} Resolves when processing for this turn is complete or a terminal error occurs.
   */
  private async _processTurnInternal(agentOSStreamId: StreamId, input: AgentOSInput): Promise<void> {
    let gmi: IGMI | undefined;
    let conversationContext: ConversationContext | undefined;
    const requestedPersonaId = input.selectedPersonaId || 'default';
    let activePersonaId: string = requestedPersonaId;
    let gmiInstanceIdForChunks = 'gmi_pending_initialization';
    let activeStreamCtx: ActiveStreamContext | undefined;

    try {
      const gmiResult = await this.dependencies.gmiManager.getOrCreateGMIForSession(
        input.userId,
        input.sessionId || agentOSStreamId,
        requestedPersonaId, 
        input.conversationId
      );
      gmi = gmiResult.gmi;
      conversationContext = gmiResult.conversationContext;
      activePersonaId = gmi.getCurrentPrimaryPersonaId(); // Ensure this returns a string
      gmiInstanceIdForChunks = gmi.getGMIId();

      activeStreamCtx = {
        gmi, userId: input.userId, sessionId: input.sessionId || agentOSStreamId, personaId: activePersonaId,
        conversationId: conversationContext.sessionId, 
        conversationContext, userApiKeys: input.userApiKeys, processingOptions: input.options
      };
      this.activeStreamContexts.set(agentOSStreamId, activeStreamCtx);

      await this.pushChunkToStream(
        agentOSStreamId, AgentOSResponseChunkType.SYSTEM_PROGRESS,
        gmiInstanceIdForChunks, activePersonaId, false,
        { message: `Persona ${activePersonaId} ready. GMI Instance: ${gmiInstanceIdForChunks}`, progressPercentage: 10 }
      );

      const gmiTurnInput = this.constructGMITurnInput(agentOSStreamId, input, activePersonaId);
      
      const gmiStreamIterator = gmi.processTurnStream(gmiTurnInput);
      let finalGMIOutputFromStream: GMIOutput | undefined; 

      let iteratorResult = await gmiStreamIterator.next();
      while (!iteratorResult.done) {
        const gmiChunk = iteratorResult.value as GMIOutputChunk;
        await this.transformAndPushGMIChunk(agentOSStreamId, activeStreamCtx, gmiChunk);
        
        if (gmiChunk.type === GMIOutputChunkType.TOOL_CALL_REQUEST) {
          console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): GMI requested tool(s). Pausing internal GMI processing for this turn.`);
          return; 
        }
        iteratorResult = await gmiStreamIterator.next();
      }
      finalGMIOutputFromStream = iteratorResult.value as GMIOutput | undefined;

      if (this.config.enableConversationalPersistence && conversationContext) {
      if (finalGMIOutputFromStream?.responseText) {
        const assistantTextMessage: Omit<ConversationMessage, 'id' | 'timestamp'> = {
          role: MessageRole.ASSISTANT,
          content: finalGMIOutputFromStream.responseText,
          metadata: { agentPersonaId: activePersonaId },
        };
        conversationContext.addMessage(assistantTextMessage);
      }
      if (finalGMIOutputFromStream?.toolCalls) {
        const assistantToolMessage: Omit<ConversationMessage, 'id' | 'timestamp'> = {
          role: MessageRole.ASSISTANT,
          content: null,
          tool_calls: finalGMIOutputFromStream.toolCalls,
          metadata: { agentPersonaId: activePersonaId },
        };
        conversationContext.addMessage(assistantToolMessage);
      }
        await this.dependencies.conversationManager.saveConversation(conversationContext);
      }

      const personaDef = gmi.getPersona();
      
      if (!finalGMIOutputFromStream) {
        console.warn(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): GMI stream completed without an explicit final GMIOutput. Constructing a default final response.`);
        const lastMessage = activeStreamCtx.conversationContext.getLastMessage();
        finalGMIOutputFromStream = {
          isFinal: true,
          responseText: lastMessage?.role === MessageRole.ASSISTANT ? (lastMessage.content as string || "Processing concluded.") : "Processing concluded.",
        };
      }
      
      await this.pushChunkToStream(
        agentOSStreamId, AgentOSResponseChunkType.FINAL_RESPONSE,
        gmiInstanceIdForChunks, activePersonaId, true, 
        {
          finalResponseText: finalGMIOutputFromStream.responseText,
          finalToolCalls: finalGMIOutputFromStream.toolCalls,
          finalUiCommands: finalGMIOutputFromStream.uiCommands,
          audioOutput: finalGMIOutputFromStream.audioOutput,
          imageOutput: finalGMIOutputFromStream.imageOutput,
          usage: normalizeUsage(finalGMIOutputFromStream.usage),
          reasoningTrace: finalGMIOutputFromStream.reasoningTrace,
          error: finalGMIOutputFromStream.error,
          updatedConversationContext: conversationContext.toJSON(),
          activePersonaDetails: snapshotPersonaDetails(personaDef),
        }
      );
      
        // TS2554 fix: Pass only 1 or 2 arguments
      await this.dependencies.streamingManager.closeStream(agentOSStreamId, "Turn processing complete."); 

    } catch (error: any) {
      const gmiErr = createGMIErrorFromError(error, GMIErrorCode.GMI_PROCESSING_ERROR, { agentOSStreamId }, `Unhandled error in _processTurnInternal`);
      console.error(`AgentOSOrchestrator: Error during _processTurnInternal for stream ${agentOSStreamId}:`, gmiErr);
      const personaIdForCatch = activePersonaId! || input.selectedPersonaId || 'unknown_error_persona'; // activePersonaId should be set if try block started
      await this.pushErrorChunk(
        agentOSStreamId, personaIdForCatch, gmiInstanceIdForChunks,
        gmiErr.code, gmiErr.message, gmiErr.details
      );
      if (this.activeStreamContexts.has(agentOSStreamId)) {
        // TS2554 fix: Pass only 1 or 2 arguments
        await this.dependencies.streamingManager.closeStream(agentOSStreamId, `Error: ${gmiErr.message}`); 
      }
    } finally {
      this.activeStreamContexts.delete(agentOSStreamId);
      console.log(`AgentOSOrchestrator: Cleaned up context for AgentOS Stream ${agentOSStreamId}.`);
    }
  }
  
  /**
   * Handles the result of an externally executed tool, feeding it back into the active GMI instance.
   * It then processes the GMI's subsequent output (`GMIOutput`), streaming further responses or
   * new tool requests as needed.
   *
   * @public
   * @async
   * @param {StreamId} agentOSStreamId - The orchestrator-level stream ID for this interaction flow.
   * @param {string} toolCallId - The ID of the specific tool call (from `ToolCallRequest`) whose result is being provided.
   * @param {string} toolName - The name of the tool that was executed.
   * @param {any} toolOutput - The output data returned by the tool execution.
   * @param {boolean} isSuccess - A flag indicating whether the tool execution was successful.
   * @param {string} [errorMessage] - An optional error message if `isSuccess` is false.
   * @returns {Promise<void>} Resolves when the tool result has been processed and subsequent GMI output streamed.
   * @throws {GMIError} If the `agentOSStreamId` is not found or if a critical error occurs during GMI's handling of the tool result.
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
    const streamContext = this.activeStreamContexts.get(agentOSStreamId);

    if (!streamContext) {
      const errMsg = `AgentOSOrchestrator: Cannot orchestrate tool result. No active stream context found for streamId: ${agentOSStreamId}. Tool: ${toolName}, CallID: ${toolCallId}`;
      console.error(errMsg);
      throw new GMIError(errMsg, GMIErrorCode.RESOURCE_NOT_FOUND, { agentOSStreamId, toolCallId, toolName });
    }

    const { gmi, userId, personaId, userApiKeys } = streamContext; // Removed conversationContext as it's not directly used here
    const gmiInstanceIdForChunks = gmi.getGMIId();

    const toolResultPayload: ToolResultPayload = isSuccess
      ? { type: 'success', result: toolOutput }
      : { type: 'error', error: { code: 'EXTERNAL_TOOL_ERROR', message: errorMessage || `External tool '${toolName}' execution failed.` } };

    console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Feeding tool result for GMI ${gmiInstanceIdForChunks}, Tool Call ID ${toolCallId} (${toolName}) back to GMI.`);

    try {
      await this.pushChunkToStream(
        agentOSStreamId, AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
        gmiInstanceIdForChunks, personaId, false,
        { toolCallId, toolName, toolResult: toolOutput, isSuccess, errorMessage }
      );

      const gmiOutputAfterTool: GMIOutput = await gmi.handleToolResult(
        toolCallId, toolName, toolResultPayload, userId, userApiKeys || {}
      );
      
      await this.processGMIOutput(agentOSStreamId, streamContext, gmiOutputAfterTool, true);

      if (gmiOutputAfterTool.toolCalls && gmiOutputAfterTool.toolCalls.length > 0 && !gmiOutputAfterTool.isFinal) {
        await this.pushChunkToStream(
          agentOSStreamId, AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          gmiInstanceIdForChunks, personaId, false,
          { toolCalls: gmiOutputAfterTool.toolCalls, rationale: gmiOutputAfterTool.responseText || "Agent requires further tool execution based on previous tool's result." }
        );
      } else if (gmiOutputAfterTool.isFinal) {
        console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): GMI interaction concluded as final after tool result processing.`);
      }

    } catch (error: any) {
      const gmiErr = createGMIErrorFromError(error, GMIErrorCode.TOOL_ERROR, { agentOSStreamId, toolCallId, toolName }, `Error processing tool result for '${toolName}'`);
      console.error(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Critical error during orchestrateToolResult:`, gmiErr);
      await this.pushErrorChunk(
        agentOSStreamId, personaId, gmiInstanceIdForChunks,
        gmiErr.code, gmiErr.message, gmiErr.details
      );
      if (this.activeStreamContexts.has(agentOSStreamId)) {
        // TS2554 fix: Pass only 1 or 2 arguments
        await this.dependencies.streamingManager.closeStream(agentOSStreamId, `Critical error during tool result processing: ${gmiErr.message}`);
        this.activeStreamContexts.delete(agentOSStreamId);
      }
    }
  }
  
  /**
   * Processes a direct `GMIOutput` object (typically the result of `gmi.handleToolResult` or the
   * final return value of `gmi.processTurnStream`). It transforms and pushes the relevant
   * parts of this `GMIOutput` as `AgentOSResponse` chunks to the client stream.
   *
   * @private
   * @async
   * @param {StreamId} agentOSStreamId - The ID of the AgentOS stream.
   * @param {ActiveStreamContext} streamContext - The context for the current active stream.
   * @param {GMIOutput} gmiOutput - The GMI output object to process.
   * @param {boolean} isContinuationAfterTool - Indicates if this output is a direct result of processing a tool.
   * @returns {Promise<void>}
   */
  private async processGMIOutput(
      agentOSStreamId: StreamId,
      streamContext: ActiveStreamContext,
      gmiOutput: GMIOutput,
      isContinuationAfterTool: boolean
  ): Promise<void> {
      const { gmi, personaId, conversationContext } = streamContext;
      const gmiInstanceIdForChunks = gmi.getGMIId();

      if (gmiOutput.responseText) {
        await this.pushChunkToStream(
          agentOSStreamId, AgentOSResponseChunkType.TEXT_DELTA,
          gmiInstanceIdForChunks, personaId, false,
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
        if (this.activeStreamContexts.has(agentOSStreamId)) {
            // TS2554 fix: Pass only 1 or 2 arguments
          await this.dependencies.streamingManager.closeStream(agentOSStreamId, `GMI reported an error: ${gmiOutput.error.message}`);
          this.activeStreamContexts.delete(agentOSStreamId);
        }
        return;
      }

      if (gmiOutput.isFinal && (!gmiOutput.toolCalls || gmiOutput.toolCalls.length === 0)) {
        if (this.config.enableConversationalPersistence && conversationContext) {
          try {
            if (gmiOutput.responseText) {
        const assistantFinalMessage: Omit<ConversationMessage, 'id' | 'timestamp'> = {
          role: MessageRole.ASSISTANT,
          content: gmiOutput.responseText,
          metadata: { agentPersonaId: personaId },
        };
        conversationContext.addMessage(assistantFinalMessage);
            }
            await this.dependencies.conversationManager.saveConversation(conversationContext);
            console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Conversation context ${conversationContext.sessionId} saved.`);
          } catch (saveError: any) {
            console.error(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Failed to save conversation context ${conversationContext.sessionId}: ${saveError.message}`, saveError);
          }
        }
        const personaDef = gmi.getPersona();
        await this.pushChunkToStream(
          agentOSStreamId, AgentOSResponseChunkType.FINAL_RESPONSE,
          gmiInstanceIdForChunks, personaId, true,
          {
            finalResponseText: gmiOutput.responseText,
            finalToolCalls: gmiOutput.toolCalls,
            finalUiCommands: gmiOutput.uiCommands,
            audioOutput: gmiOutput.audioOutput,
            imageOutput: gmiOutput.imageOutput,
            usage: normalizeUsage(gmiOutput.usage),
            reasoningTrace: gmiOutput.reasoningTrace,
            error: gmiOutput.error,
            updatedConversationContext: conversationContext.toJSON(),
      activePersonaDetails: snapshotPersonaDetails(personaDef),
          }
        );
        if (this.activeStreamContexts.has(agentOSStreamId)) {
            // TS2554 fix: Pass only 1 or 2 arguments
          await this.dependencies.streamingManager.closeStream(agentOSStreamId, "Interaction processing complete, final response sent.");
          this.activeStreamContexts.delete(agentOSStreamId);
          console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Finalized and cleaned up stream context.`);
        }
      }
  }

  /**
   * Transforms a single `GMIOutputChunk` from the GMI's stream into one or more
   * `AgentOSResponse` chunks and pushes them to the client via the `StreamingManager`.
   *
   * @private
   * @async
   * @param {StreamId} agentOSStreamId - The ID of the AgentOS stream.
   * @param {ActiveStreamContext} streamContext - The context for the current active stream.
   * @param {GMIOutputChunk} gmiChunk - The chunk of output received from the GMI.
   * @returns {Promise<void>}
   */
  private async transformAndPushGMIChunk(
    agentOSStreamId: StreamId,
    streamContext: ActiveStreamContext,
    gmiChunk: GMIOutputChunk
  ): Promise<void> {
    const { gmi, personaId } = streamContext;
    const gmiInstanceIdForChunks = gmi.getGMIId();

    const isChunkFinal = gmiChunk.isFinal ?? false;

    switch (gmiChunk.type) {
      case GMIOutputChunkType.TEXT_DELTA:
        if (gmiChunk.content && typeof gmiChunk.content === 'string') {
          await this.pushChunkToStream( agentOSStreamId, AgentOSResponseChunkType.TEXT_DELTA,
            gmiInstanceIdForChunks, personaId, isChunkFinal, { textDelta: gmiChunk.content });
        }
        break;
      case GMIOutputChunkType.SYSTEM_MESSAGE:
        if (gmiChunk.content && typeof gmiChunk.content === 'object' && gmiChunk.content !== null) {
          const progressData = gmiChunk.content as { message: string; progressPercentage?: number; statusCode?: string};
          await this.pushChunkToStream( agentOSStreamId, AgentOSResponseChunkType.SYSTEM_PROGRESS,
            gmiInstanceIdForChunks, personaId, isChunkFinal, progressData);
        }
        break;
      case GMIOutputChunkType.TOOL_CALL_REQUEST:
        if (gmiChunk.content && Array.isArray(gmiChunk.content) && gmiChunk.content.length > 0) {
          const toolCalls = gmiChunk.content as ToolCallRequest[];
          const rationale = (gmiChunk.metadata?.rationale as string) || "Agent is considering using tools.";
          await this.pushChunkToStream( agentOSStreamId, AgentOSResponseChunkType.TOOL_CALL_REQUEST,
            gmiInstanceIdForChunks, personaId, false, // Tool call requests are typically not final for the turn
            { toolCalls, rationale });
        }
        break;
      case GMIOutputChunkType.UI_COMMAND:
        if (gmiChunk.content && Array.isArray(gmiChunk.content)) {
          await this.pushChunkToStream( agentOSStreamId, AgentOSResponseChunkType.UI_COMMAND,
            gmiInstanceIdForChunks, personaId, isChunkFinal, { uiCommands: gmiChunk.content as UICommand[] });
        }
        break;
      case GMIOutputChunkType.ERROR:
        const errorContent = gmiChunk.content;
        const errorDetailsObj = gmiChunk.errorDetails || (typeof errorContent === 'object' && errorContent !== null ? errorContent : { messageFromContent: String(errorContent) });
        
        await this.pushErrorChunk(agentOSStreamId, personaId, gmiInstanceIdForChunks,
          (errorDetailsObj as {code?: GMIErrorCode | string})?.code || GMIErrorCode.GMI_PROCESSING_ERROR,
          (errorDetailsObj as {message?: string})?.message || String(errorContent) || 'An unspecified GMI error occurred.',
          errorDetailsObj);

        if (isChunkFinal && this.activeStreamContexts.has(agentOSStreamId)) {
            // TS2554 fix: Pass only 1 or 2 arguments
          await this.dependencies.streamingManager.closeStream(agentOSStreamId, `GMI stream reported a final error: ${(errorDetailsObj as {message?: string})?.message || String(errorContent)}`);
          this.activeStreamContexts.delete(agentOSStreamId);
        }
        break;
      case GMIOutputChunkType.FINAL_RESPONSE_MARKER:
        console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Received FINAL_RESPONSE_MARKER from GMI. isFinal on chunk: ${isChunkFinal}.`);
        break;
      case GMIOutputChunkType.USAGE_UPDATE:
        if (this.config.logToolCalls) {
          console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Received USAGE_UPDATE from GMI:`, gmiChunk.content);
        }
        await this.pushChunkToStream(
          agentOSStreamId, AgentOSResponseChunkType.METADATA_UPDATE,
          gmiInstanceIdForChunks, personaId, isChunkFinal, 
          { updates: { usage: gmiChunk.content } }
        );
        break;
      case GMIOutputChunkType.REASONING_STATE_UPDATE:
        if (this.config.logToolCalls) { 
          console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): GMI Reasoning State Update:`, gmiChunk.content);
        }
        await this.pushChunkToStream(
          agentOSStreamId, AgentOSResponseChunkType.METADATA_UPDATE,
          gmiInstanceIdForChunks, personaId, isChunkFinal, 
          { updates: { reasoningState: gmiChunk.content } }
        );
        break;
      case GMIOutputChunkType.LATENCY_REPORT:
        if (this.config.logToolCalls) { 
          console.log(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): GMI Latency Report:`, gmiChunk.content);
        }
        await this.pushChunkToStream(
          agentOSStreamId, AgentOSResponseChunkType.METADATA_UPDATE,
          gmiInstanceIdForChunks, personaId, isChunkFinal,
          { updates: { latencyReport: gmiChunk.content } }
        );
        break;
      default:
        const exhaustiveCheck: never = gmiChunk.type;
        console.warn(`AgentOSOrchestrator (Stream: ${agentOSStreamId}): Encountered an unhandled GMIOutputChunkType: '${exhaustiveCheck as string}'. Chunk content:`, gmiChunk.content);
    }
  }

  /**
   * Gracefully shuts down the AgentOSOrchestrator.
   * This involves notifying and closing any active streams managed by the associated `StreamingManager`
   * and clearing internal state. Dependencies like `GMIManager` are assumed to be shut down
   * by the main `AgentOS` service.
   *
   * @public
   * @async
   * @returns {Promise<void>} A promise that resolves when the shutdown process is complete.
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      console.warn("AgentOSOrchestrator: Shutdown called but orchestrator was not initialized or already shut down.");
      return;
    }
    console.log(`AgentOSOrchestrator: Initiating shutdown. Closing ${this.activeStreamContexts.size} active stream contexts...`);
    
    const streamClosePromises: Promise<void>[] = [];
    for (const streamId of this.activeStreamContexts.keys()) {
      console.log(`AgentOSOrchestrator: Requesting closure of stream ${streamId} due to orchestrator shutdown.`);
      streamClosePromises.push(
        // TS2554 fix: Pass only 1 or 2 arguments
        this.dependencies.streamingManager.closeStream(streamId, "AgentOS Orchestrator is shutting down.")
          .catch((e: any) => console.error(`AgentOSOrchestrator: Error closing stream ${streamId} during shutdown: ${e.message}`))
      );
    }
    
    try {
      await Promise.allSettled(streamClosePromises);
    } catch (e: any) {
      console.error("AgentOSOrchestrator: Errors occurred while closing active streams during shutdown:", e);
    }

    this.activeStreamContexts.clear();
    this.initialized = false;
    console.log("AgentOSOrchestrator: Shutdown complete. All active stream contexts cleared.");
  }
}
