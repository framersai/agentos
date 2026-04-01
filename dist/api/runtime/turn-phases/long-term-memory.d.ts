/**
 * @fileoverview Long-term memory retrieval phase.
 * Checks cadence, retrieves durable memories, and updates retrieval state.
 */
import type { ConversationContext } from '../../../core/conversation/ConversationContext';
import type { ILongTermMemoryRetriever } from '../../../core/conversation/ILongTermMemoryRetriever';
import { type ResolvedLongTermMemoryPolicy } from '../../../core/conversation/LongTermMemoryPolicy';
import { type GMITurnInput } from '../../../cognitive_substrate/IGMI';
export interface LongTermMemoryPhaseInput {
    conversationContext: ConversationContext | undefined;
    longTermMemoryRetriever: ILongTermMemoryRetriever | undefined;
    longTermMemoryPolicy: ResolvedLongTermMemoryPolicy | null;
    gmiInput: GMITurnInput;
    streamId: string;
    userId: string;
    organizationId: string | undefined;
    conversationId: string;
    personaId: string;
    modeForRouting: string;
    recallConfig: {
        cadenceTurns: number;
        forceOnCompaction: boolean;
        maxContextChars: number;
        topKByScope: Record<'user' | 'persona' | 'organization', number>;
    };
    didCompact: boolean;
}
export interface LongTermMemoryPhaseResult {
    contextText: string | null;
    diagnostics: Record<string, unknown> | undefined;
    feedbackPayload?: unknown;
    shouldReview: boolean;
    reviewReason: string | null;
}
export declare function executeLongTermMemoryPhase(input: LongTermMemoryPhaseInput): Promise<LongTermMemoryPhaseResult>;
//# sourceMappingURL=long-term-memory.d.ts.map