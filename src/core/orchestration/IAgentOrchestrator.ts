// File: backend/agentos/core/orchestration/IAgentOrchestrator.ts
// backend/agentos/core/orchestration/IAgentOrchestrator.ts

import { ConversationContext } from '../conversation/ConversationContext';
import { AgentOutput } from '../agents/IAgent'; // Assuming AgentOutput is defined in IAgent
// Corrected: Ensure AgentOrchestratorDependencies is imported from the concrete implementation or a shared types file if it exists
import { AgentOSOrchestratorDependencies as AgentOrchestratorDependencies } from './AgentOrchestrator'; // Changed to concrete from AgentOS

/**
 * @fileoverview Defines the interface for an Agent Orchestrator in AgentOS.
 * The orchestrator manages the lifecycle of an agent's interaction for a given
 * user query or task, handling turns, tool calls, and potential agent handoffs.
 * @module agentos/core/orchestration/IAgentOrchestrator
 */

/**
 * Configuration options for the AgentOrchestrator.
 */
export interface AgentOrchestratorConfig { // Note: This might be AgentOSOrchestratorConfig based on the other file
  /** Maximum number of sequential tool calls allowed in a single agent turn to prevent loops. @default 5 */
  maxToolCallIterations?: number;
  /** Default timeout in milliseconds for an agent's `processTurn` or `handleToolResult` method. @default 60000 (60 seconds) */
  defaultAgentTurnTimeoutMs?: number;
  /**
   * ID of a default "Error Handling Agent" or a meta-agent to consult if an orchestrated agent
   * enters an unrecoverable error state. If not set, orchestrator handles errors more directly.
   */
  errorHandlingAgentId?: string;
  /** If true, orchestrator logs detailed information about tool calls. */ // Corrected: Added logToolCalls
  logToolCalls?: boolean;
}

/**
 * @interface IAgentOrchestrator
 * Defines the contract for the central service that coordinates agent execution.
 * This name IAgentOrchestrator seems to be for a more generic agent orchestrator,
 * while the file being fixed is AgentOSOrchestrator.ts which is more GMI-focused.
 * Assuming AgentOrchestratorConfig here is the one intended for AgentOSOrchestrator.
 */
export interface IAgentOrchestrator { // This interface might not be directly implemented by AgentOSOrchestrator if its config is different.
  /** A unique identifier for this orchestrator implementation. */
  readonly orchestratorId: string;

  /**
   * Initializes the agent orchestrator.
   * @param {AgentOrchestratorConfig} config - Orchestrator-specific configuration.
   * @param {AgentOrchestratorDependencies} dependencies - Other necessary services.
   */
  initialize(config: AgentOrchestratorConfig, dependencies: AgentOrchestratorDependencies): Promise<void>;

  processAgentTurn(
    conversationContext: ConversationContext,
    userInput: string | null,
    targetAgentId: string
  ): Promise<AgentOutput>;

  initiateAgentHandoff?(
    conversationContext: ConversationContext,
    currentAgentOutput: AgentOutput,
    nextAgentId: string,
    handoffData?: any
  ): Promise<AgentOutput>;
}