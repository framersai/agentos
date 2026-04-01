/**
 * @fileoverview Conversation history assembly phase.
 * Builds a trimmed, deduplicated history snapshot for prompt construction.
 */
import type { ConversationContext } from '../../../core/conversation/ConversationContext';
import { type GMITurnInput } from '../../../cognitive_substrate/IGMI';
import type { RollingSummaryCompactionConfig, RollingSummaryCompactionResult } from '../../../core/conversation/RollingSummaryCompactor';
export interface ConversationHistoryPhaseInput {
    conversationContext: ConversationContext | undefined;
    gmiInput: GMITurnInput;
    rollingSummaryEnabled: boolean;
    rollingSummaryResult: RollingSummaryCompactionResult | null;
    rollingSummaryText: string;
    rollingSummaryConfigForTurn: RollingSummaryCompactionConfig | null;
}
/**
 * Build a conversation history snapshot for prompt construction.
 * When rolling summary is active, trims history to head messages + unsummarized tail.
 * Deduplicates the current user message if already in history.
 */
export declare function assembleConversationHistory(input: ConversationHistoryPhaseInput): any[] | null;
//# sourceMappingURL=conversation-history.d.ts.map