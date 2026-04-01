/**
 * @fileoverview Rolling summary compaction phase.
 * Selects a compaction profile and runs maybeCompactConversationMessages.
 */
import type { ConversationContext } from '../../../core/conversation/ConversationContext';
import type { AIModelProviderManager } from '../../../core/llm/providers/AIModelProviderManager';
import { type RollingSummaryCompactionConfig, type RollingSummaryCompactionResult } from '../../../core/conversation/RollingSummaryCompactor';
import type { RollingSummaryCompactionProfilesConfig } from '../../types/OrchestratorConfig';
export interface RollingSummaryPhaseInput {
    conversationContext: ConversationContext | undefined;
    modeForRouting: string;
    streamId: string;
    /** Base compaction config from orchestrator config (may be null/disabled). */
    rollingSummaryCompactionConfig: RollingSummaryCompactionConfig | null;
    rollingSummaryCompactionProfilesConfig: RollingSummaryCompactionProfilesConfig | null;
    rollingSummarySystemPrompt: string;
    rollingSummaryStateKey: string;
    modelProviderManager: AIModelProviderManager;
}
export interface RollingSummaryPhaseResult {
    result: RollingSummaryCompactionResult | null;
    profileId: string | null;
    configForTurn: RollingSummaryCompactionConfig | null;
    enabled: boolean;
    summaryText: string;
}
export declare function executeRollingSummaryPhase(input: RollingSummaryPhaseInput): Promise<RollingSummaryPhaseResult>;
//# sourceMappingURL=rolling-summary.d.ts.map