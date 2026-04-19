/**
 * @fileoverview Long-term memory retrieval phase.
 * Checks cadence, retrieves durable memories, and updates retrieval state.
 */
import { DEFAULT_LONG_TERM_MEMORY_POLICY, } from '../../../core/conversation/LongTermMemoryPolicy.js';
import { MessageRole } from '../../../core/conversation/ConversationMessage.js';
import { GMIInteractionType } from '../../../cognitive_substrate/IGMI.js';
export async function executeLongTermMemoryPhase(input) {
    const { conversationContext, longTermMemoryRetriever, longTermMemoryPolicy, } = input;
    const policyEnabled = Boolean(longTermMemoryPolicy?.enabled);
    const hasScopes = Boolean(longTermMemoryPolicy?.scopes?.user) ||
        Boolean(longTermMemoryPolicy?.scopes?.persona) ||
        Boolean(longTermMemoryPolicy?.scopes?.organization);
    if (!conversationContext || !longTermMemoryRetriever || !policyEnabled || !hasScopes) {
        return {
            contextText: null,
            diagnostics: undefined,
            feedbackPayload: undefined,
            shouldReview: false,
            reviewReason: 'retriever_not_applicable',
        };
    }
    try {
        const queryText = input.gmiInput.type === GMIInteractionType.TEXT && typeof input.gmiInput.content === 'string'
            ? input.gmiInput.content.trim()
            : input.gmiInput.type === GMIInteractionType.MULTIMODAL_CONTENT
                ? JSON.stringify(input.gmiInput.content).trim()
                : '';
        const userTurnCount = conversationContext.getAllMessages().filter((m) => m?.role === MessageRole.USER).length;
        const { cadenceTurns, forceOnCompaction } = input.recallConfig;
        const rawState = conversationContext.getMetadata('longTermMemoryRetrievalState');
        const prevState = rawState &&
            typeof rawState === 'object' &&
            typeof rawState.lastReviewedUserTurn === 'number'
            ? rawState
            : null;
        const turnsSinceReview = prevState
            ? Math.max(0, userTurnCount - prevState.lastReviewedUserTurn)
            : Number.POSITIVE_INFINITY;
        const dueToCadence = !prevState || turnsSinceReview >= cadenceTurns;
        const dueToCompaction = forceOnCompaction && input.didCompact;
        const shouldReview = dueToCadence || dueToCompaction;
        let reviewReason;
        if (shouldReview) {
            reviewReason = !prevState ? 'initial_review' : dueToCompaction ? 'forced_on_compaction' : 'cadence_due';
        }
        else {
            reviewReason = 'cadence_not_due';
        }
        let contextText = null;
        let diagnostics;
        let feedbackPayload;
        if (shouldReview && queryText.length > 0) {
            const retrievalResult = await longTermMemoryRetriever.retrieveLongTermMemory({
                userId: input.userId,
                organizationId: input.organizationId,
                conversationId: input.conversationId,
                personaId: input.personaId,
                mode: input.modeForRouting,
                queryText,
                memoryPolicy: longTermMemoryPolicy ?? DEFAULT_LONG_TERM_MEMORY_POLICY,
                retrievalPolicy: longTermMemoryPolicy?.retrieval ?? undefined,
                maxContextChars: input.recallConfig.maxContextChars,
                topKByScope: input.recallConfig.topKByScope,
            });
            if (retrievalResult?.contextText?.trim()) {
                contextText = retrievalResult.contextText.trim();
                diagnostics = retrievalResult.diagnostics;
                feedbackPayload = retrievalResult.feedbackPayload;
            }
            conversationContext.setMetadata('longTermMemoryRetrievalState', {
                lastReviewedUserTurn: userTurnCount,
                lastReviewedAt: Date.now(),
            });
        }
        else if (shouldReview && queryText.length === 0) {
            reviewReason = 'empty_query';
        }
        return { contextText, diagnostics, feedbackPayload, shouldReview, reviewReason };
    }
    catch (retrievalError) {
        console.warn(`Long-term memory retrieval failed for stream ${input.streamId} (continuing without it).`, retrievalError);
        return {
            contextText: null,
            diagnostics: undefined,
            feedbackPayload: undefined,
            shouldReview: true,
            reviewReason: 'retrieval_error',
        };
    }
}
//# sourceMappingURL=long-term-memory.js.map