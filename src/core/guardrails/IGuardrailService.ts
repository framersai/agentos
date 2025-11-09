import type { AgentOSInput } from '../../api/types/AgentOSInput';
import type { AgentOSResponse } from '../../api/types/AgentOSResponse';

/**
 * High-level outcome emitted by a guardrail evaluation.
 * The action instructs AgentOS (or the host) how to proceed.
 */
export enum GuardrailAction {
  /**
   * Allow the content to pass through unchanged.
   */
  ALLOW = 'allow',
  /**
   * Allow the request/response but record metadata (e.g. for analytics).
   */
  FLAG = 'flag',
  /**
   * Continue processing after replacing user/assistant content with a sanitised version.
   */
  SANITIZE = 'sanitize',
  /**
   * Block the interaction entirely and return an error back to the host.
   */
  BLOCK = 'block',
}

/**
 * Lightweight description of the conversational context
 * that is relevant for guardrail decisions.
 */
export interface GuardrailContext {
  userId: string;
  sessionId: string;
  personaId?: string;
  conversationId?: string;
  mode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result returned by a guardrail evaluation stage.
 */
export interface GuardrailEvaluationResult {
  action: GuardrailAction;
  /**
   * Optional short reason that can be shown to the end user or logged.
   */
  reason?: string;
  /**
   * Machine readable code (e.g. policy identifier).
   */
  reasonCode?: string;
  /**
   * Additional metadata that hosts may want to persist.
   */
  metadata?: Record<string, unknown>;
  /**
   * Free-form details (stack traces, moderation results, etc.).
   */
  details?: unknown;
  /**
   * Replacement text to use when {@link GuardrailAction.SANITIZE} is returned.
   */
  modifiedText?: string | null;
}

/**
 * Payload supplied to the guardrail service before a request
 * enters the orchestration pipeline.
 */
export interface GuardrailInputPayload {
  context: GuardrailContext;
  input: AgentOSInput;
}

/**
 * Payload supplied to the guardrail service right before
 * a response chunk is emitted to the host.
 */
export interface GuardrailOutputPayload {
  context: GuardrailContext;
  chunk: AgentOSResponse;
}

/**
 * Configuration for guardrail evaluation behavior.
 */
export interface GuardrailConfig {
  /**
   * If true, evaluates TEXT_DELTA chunks during streaming (real-time redaction).
   * If false, only evaluates FINAL_RESPONSE chunks (default, faster, lower cost).
   * 
   * **Performance Impact:**
   * - Streaming evaluation: Adds 1-500ms latency per TEXT_DELTA chunk
   * - Final-only evaluation: Adds 1-500ms latency once per response
   * 
   * **Cost Impact:**
   * - Streaming evaluation: May trigger LLM calls per chunk (if using LLM-powered guardrails)
   * - Final-only evaluation: Single evaluation per response
   * 
   * **Use Cases:**
   * - Streaming: Real-time PII redaction, immediate blocking of harmful content
   * - Final-only: Cost-sensitive deployments, policy checks that need full context
   * 
   * @default false
   */
  evaluateStreamingChunks?: boolean;
  
  /**
   * Maximum number of streaming chunks to evaluate per request.
   * Only applies when evaluateStreamingChunks is true.
   * Set to limit cost/performance impact of streaming evaluation.
   * 
   * @default undefined (no limit)
   */
  maxStreamingEvaluations?: number;
}

/**
 * Contract that host applications can implement to inject
 * custom guardrail logic (moderation, policy enforcement, censorship).
 *
 * Both methods are optional to keep the package lightweight — provide
 * implementations for the stages you care about.
 */
export interface IGuardrailService {
  /**
   * Optional configuration for guardrail evaluation behavior.
   */
  config?: GuardrailConfig;
  
  /**
   * Evaluate user input before the orchestration pipeline executes.
   * Returning {@link GuardrailAction.BLOCK} will prevent the request from being processed.
   */
  evaluateInput?(payload: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null>;

  /**
   * Inspect the agent's response chunks before they are streamed to the client.
   * You can flag, sanitise, or block chunks.
   * 
   * **Evaluation Timing:**
   * - If `config.evaluateStreamingChunks === true`: Called for every TEXT_DELTA chunk
   * - Otherwise: Called only for FINAL_RESPONSE chunks
   * 
   * **Performance Note:**
   * Streaming evaluation adds latency per chunk. Use final-only evaluation unless
   * real-time redaction is required.
   */
  evaluateOutput?(payload: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null>;
}
