// backend/agentos/api/interfaces/IUnifiedAgent.ts

import { ConversationContext } from '../../core/conversation/ConversationContext';
// import { AgentOSResponseChunkType, AgentOSResponse } from '../types/AgentOSResponse'; // Not used in this file
import { ToolCallRequest, UICommand } from '../../cognitive_substrate/IGMI'; // Corrected import
import { IPersonaDefinition } from '../../cognitive_substrate/personas/IPersonaDefinition'; // To reflect persona's definition

/**
 * @fileoverview Defines the interface for a Unified Agent within the AgentOS framework.
 * In the new architecture, "Personas ARE Agents." This interface represents the core
 * capabilities and expected behaviors of any persona that acts as an intelligent agent
 * within the Generalized Mind Instance (GMI). It defines what a GMI-powered agent
 * can do, primarily focusing on processing turns and handling tool results.
 *
 * This is an *internal* interface, primarily used by the GMI and its related processing
 * components, not directly by the public-facing AgentOS API.
 * @module backend/agentos/api/interfaces/IUnifiedAgent
 */

/**
 * @typedef {Object} UnifiedAgentOutput
 * @property {string | null} [responseText] - The textual response from the agent. Can be `null`
 * if the agent is primarily performing tool calls or UI commands.
 * @property {ToolCallRequest[]} [toolCalls] - An array of tool call requests the agent wants to execute.
 * @property {UICommand[]} [uiCommands] - An array of UI commands the agent wants the frontend to render/execute.
 * @property {boolean} isComplete - Indicates if the agent considers its current task or turn complete.
 * If `false`, the GMI may continue iterating (e.g., waiting for tool results).
 * @property {Error | null} [error] - An error object if the agent encountered a problem.
 * @property {Record<string, any>} [metadata] - Arbitrary additional metadata from the agent.
 */
export interface UnifiedAgentOutput {
  responseText?: string | null;
  toolCalls?: ToolCallRequest[]; // Corrected type
  uiCommands?: UICommand[];      // Corrected type
  isComplete: boolean;
  error?: Error | null;
  metadata?: Record<string, any>;
}

/**
 * @interface IUnifiedAgent
 * @description
 * Represents the conceptual "agent" component that the GMI orchestrates.
 * Each instance of a `PersonaDefinition` effectively _becomes_ an `IUnifiedAgent`
 * through the GMI's cognitive processes. This interface outlines how the GMI
 * interacts with the "agentic" capabilities derived from a persona.
 *
 * Note: The concrete implementation of these methods often resides within
 * internal "Agent Processors" that the GMI coordinates. This interface serves
 * as a contract for the GMI's internal interaction with agentic behavior.
 */
export interface IUnifiedAgent {
  /**
   * The unique identifier of this agent (which is derived from its Persona ID).
   */
  readonly id: string;

  /**
   * The name of this agent (derived from its Persona name).
   */
  readonly name: string;

  /**
   * The description of this agent (derived from its Persona description).
   */
  readonly description: string;

  /**
   * The full PersonaDefinition that this Unified Agent is based on.
   * This provides access to all the configuration and traits of the active persona.
   */
  readonly personaDefinition: IPersonaDefinition;

  /**
   * Processes a logical "turn" for this Unified Agent. This method takes user input
   * and the current conversation context, performs reasoning, potentially calls tools,
   * and generates a response.
   *
   * @async
   * @param {string | null} userInput - The latest textual input from the user. Can be `null`
   * if the agent is acting autonomously or processing a tool result.
   * @param {ConversationContext} conversationContext - The current state of the conversation,
   * including message history and metadata. The agent updates this context.
   * @param {string} currentStreamId - The ID of the current streaming turn, for consistent
   * tracking of outputs.
   * @returns {Promise<UnifiedAgentOutput>} A promise that resolves to the agent's output,
   * including text, tool calls, UI commands, and a completion status.
   */
  processTurn(
    userInput: string | null,
    conversationContext: ConversationContext,
    currentStreamId: string,
  ): Promise<UnifiedAgentOutput>;

  /**
   * Handles the result of a tool execution that this agent previously requested.
   * The agent uses this information to continue its thought process, potentially
   * generating a new response, making further tool calls, or declaring completion.
   *
   * @async
   * @param {string} toolCallId - The ID of the original tool call this result pertains to.
   * @param {any} toolOutput - The raw output or result from the tool execution.
   * @param {string} toolName - The name of the tool that was called.
   * @param {ConversationContext} conversationContext - The current conversation context,
   * already updated with the tool's result message. The agent updates this further.
   * @param {string} currentStreamId - The ID of the current streaming turn.
   * @returns {Promise<UnifiedAgentOutput>} A promise that resolves to the agent's subsequent output.
   */
  handleToolResult(
    toolCallId: string,
    toolOutput: any,
    toolName: string,
    conversationContext: ConversationContext,
    currentStreamId: string,
  ): Promise<UnifiedAgentOutput>;

  /**
   * Allows the Unified Agent to perform any specific setup or initialization
   * logic that might be required after its PersonaDefinition has been loaded
   * and the GMI is prepared.
   *
   * @async
   * @param {Record<string, any>} [options] - Optional configuration or parameters for initialization.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   */
  initialize?(options?: Record<string, any>): Promise<void>;

  /**
   * Resets the agent's ephemeral internal state, if any, for a new conversation
   * or session. This should not affect long-term memory managed by GMI's working memory.
   *
   * @returns {void}
   */
  reset?(): void;

  /**
   * Provides a mechanism for the agent to gracefully handle and explain internal
   * errors, generating a user-friendly response when something goes wrong unexpectedly.
   *
   * @async
   * @param {string} internalErrorDescription - A technical description of the internal error.
   * @param {ConversationContext} conversationContext - The current conversation context.
   * @param {boolean} [isFatalForTurn=false] - If `true`, indicates the error is critical
   * and the current turn cannot proceed meaningfully.
   * @param {string} currentStreamId - The ID of the current streaming turn.
   * @returns {Promise<UnifiedAgentOutput>} An output containing a user-facing explanation.
   */
  handleInternalError?(
    internalErrorDescription: string,
    conversationContext: ConversationContext,
    isFatalForTurn?: boolean,
    currentStreamId?: string,
  ): Promise<UnifiedAgentOutput>;
}