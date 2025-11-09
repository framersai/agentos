// File: backend/agentos/api/types/AgentOSInput.ts
/**
 * @fileoverview Defines the unified input structure for the AgentOS API.
 * This interface encapsulates all possible data and options a user or
 * client might provide when interacting with an AgentOS instance.
 * It emphasizes clarity, type safety, and comprehensive data capture for
 * sophisticated GMI interactions.
 *
 * @module backend/agentos/api/types/AgentOSInput
 * @see ../../cognitive_substrate/IGMI.ts For VisionInputData and AudioInputData definitions.
 */

import { VisionInputData, AudioInputData } from '../../cognitive_substrate/IGMI';

/**
 * Defines the structure for user-provided feedback on a GMI's performance or a specific message.
 * This feedback is crucial for the GMI's adaptive learning capabilities and for system analytics.
 *
 * @interface UserFeedbackPayload
 */
export interface UserFeedbackPayload {
  rating?: 'positive' | 'negative' | 'neutral';
  score?: number;
  text?: string;
  tags?: string[];
  correctedContent?: string;
  targetMessageId?: string;
  customData?: Record<string, any>;
}

/**
 * Encapsulates all data and options for a single interaction turn with AgentOS.
 * This structure is designed to be comprehensive, supporting multimodal inputs,
 * persona selection, user-specific API keys, explicit feedback, conversation
 * management, and fine-grained processing controls.
 *
 * @interface AgentOSInput
 */
export interface WorkflowInvocationRequest {
  definitionId: string;
  workflowId?: string;
  conversationId?: string;
  context?: Record<string, unknown>;
  roleAssignments?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Describes a request to create or join an Agency (multi-GMI collective).
 */
export interface AgencyInvocationRequest {
  /**
   * Existing agency identifier to join. If omitted, a new agency is instantiated.
   */
  agencyId?: string;
  /**
   * Optional workflow identifier to bind the agency to.
   */
  workflowId?: string;
  /**
   * High-level description of the shared objective.
   */
  goal?: string;
  /**
   * Desired seats within the agency along with their preferred personas.
   */
  participants?: Array<{ roleId: string; personaId?: string }>;
  /**
   * Arbitrary metadata for agency initialization.
   */
  metadata?: Record<string, unknown>;
}

export interface AgentOSInput {
  userId: string;
  sessionId: string;
  textInput: string | null;
  visionInputs?: VisionInputData[];
  audioInput?: AudioInputData;
  selectedPersonaId?: string;
  /** Optional explicit language hint from UI (BCP-47 or ISO 639-1). */
  languageHint?: string;
  /** Optional detected languages supplied externally (highest confidence first). */
  detectedLanguages?: Array<{ code: string; confidence: number }>;
  /** Optional target language override (skips negotiation if supported). */
  targetLanguage?: string;
  userApiKeys?: Record<string, string>;
  userFeedback?: UserFeedbackPayload;
  conversationId?: string;
  workflowRequest?: WorkflowInvocationRequest;
  agencyRequest?: AgencyInvocationRequest;
  options?: ProcessingOptions;
}

/**
 * Defines fine-grained control options for how AgentOS processes an individual turn.
 * These options can override system defaults or persona-specific settings for the duration
 * of the current request, allowing for dynamic adjustments to GMI behavior and output.
 *
 * @interface ProcessingOptions
 */
export interface ProcessingOptions {
  streamUICommands?: boolean;
  maxToolCallIterations?: number;
  preferredModelId?: string;
  preferredProviderId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  disableAdaptation?: boolean;
  debugMode?: boolean;
  forceNewConversation?: boolean;
  customFlags?: Record<string, any>;
}
