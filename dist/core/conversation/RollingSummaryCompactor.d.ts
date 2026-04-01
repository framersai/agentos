import type { ChatMessage, ModelCompletionOptions } from '../llm/providers/IProvider';
import type { ConversationMessage } from './ConversationMessage';
export interface RollingSummaryCompactionConfig {
    enabled: boolean;
    /**
     * Model id used for compaction.
     *
     * Note: model ids are provider-specific:
     * - OpenAI provider: `gpt-4o-mini`
     * - OpenRouter provider: `openai/gpt-4o-mini`
     *
     * Keep this cheap/fast by default; it runs occasionally.
     */
    modelId: string;
    /** Provider id override (optional). */
    providerId?: string;
    /** Minimum time between compaction passes per conversation. */
    cooldownMs: number;
    /** Preserve the first N messages verbatim (usually system + initial user). */
    headMessagesToKeep: number;
    /** Preserve the last N messages verbatim (fresh context). */
    tailMessagesToKeep: number;
    /** Minimum number of messages to summarize in a pass. */
    minMessagesToSummarize: number;
    /** Maximum number of messages summarized per pass (older-first). */
    maxMessagesToSummarizePerPass: number;
    /** Maximum output tokens for the compactor model. */
    maxOutputTokens: number;
    /** Optional temperature for the compactor model. */
    temperature?: number;
}
export interface RollingSummaryCompactionResult {
    enabled: boolean;
    didCompact: boolean;
    summaryText: string | null;
    summaryJson: any | null;
    summaryUptoTimestamp: number | null;
    summaryUpdatedAt: number | null;
    compactedMessageCount?: number;
    reason?: string;
}
export type RollingSummaryLlmCaller = (input: {
    providerId?: string;
    modelId: string;
    messages: ChatMessage[];
    options: ModelCompletionOptions;
}) => Promise<string>;
export declare const DEFAULT_ROLLING_SUMMARY_COMPACTION_CONFIG: RollingSummaryCompactionConfig;
export declare const DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT_V1: string;
export declare function maybeCompactConversationMessages(params: {
    messages: ConversationMessage[];
    sessionMetadata: Record<string, any>;
    config: RollingSummaryCompactionConfig;
    llmCaller: RollingSummaryLlmCaller;
    systemPrompt?: string;
    stateKey?: string;
    now?: number;
}): Promise<RollingSummaryCompactionResult & {
    updatedSessionMetadata?: Record<string, any>;
}>;
//# sourceMappingURL=RollingSummaryCompactor.d.ts.map