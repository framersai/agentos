import type { ResolvedLongTermMemoryPolicy } from './LongTermMemoryPolicy';

export interface LongTermMemoryRetrievalInput {
  userId: string;
  organizationId?: string;
  conversationId: string;
  personaId: string;
  mode: string;
  queryText: string;
  memoryPolicy: ResolvedLongTermMemoryPolicy;
  /**
   * Advisory character budget for the returned context string.
   * Implementations may truncate to stay within this budget.
   */
  maxContextChars?: number;
  /**
   * Optional per-scope retrieval caps.
   * Implementations are free to ignore/override.
   */
  topKByScope?: Partial<Record<'user' | 'persona' | 'organization', number>>;
}

export interface LongTermMemoryRetrievalResult {
  /** Markdown/plain-text context to inject into the next prompt. */
  contextText: string;
  /** Optional lightweight diagnostics for UI/debugging. */
  diagnostics?: Record<string, unknown>;
  /**
   * Opaque implementation-specific payload used to record used/ignored
   * feedback after the assistant produces a final response.
   */
  feedbackPayload?: unknown;
}

export interface LongTermMemoryFeedbackInput {
  queryText: string;
  responseText: string;
  feedbackPayload?: unknown;
}

export interface ILongTermMemoryRetriever {
  retrieveLongTermMemory(
    input: LongTermMemoryRetrievalInput,
  ): Promise<LongTermMemoryRetrievalResult | null>;

  recordRetrievalFeedback?(
    input: LongTermMemoryFeedbackInput,
  ): Promise<void>;
}
