/**
 * @fileoverview Prompt profile routing phase.
 * Selects a prompt profile (concise/deep/planner/reviewer) based on conversation state.
 */
import { selectPromptProfile, } from '../../../structured/prompting/PromptProfileRouter.js';
import { GMIInteractionType } from '../../../cognitive_substrate/IGMI.js';
export function executePromptProfilePhase(input) {
    if (!input.conversationContext || !input.promptProfileConfig)
        return null;
    try {
        const rawPrev = input.conversationContext.getMetadata('promptProfileState');
        const previousState = rawPrev && typeof rawPrev === 'object' && typeof rawPrev.presetId === 'string'
            ? rawPrev
            : null;
        const userMessage = input.gmiInput.type === GMIInteractionType.TEXT && typeof input.gmiInput.content === 'string'
            ? input.gmiInput.content
            : input.gmiInput.type === GMIInteractionType.MULTIMODAL_CONTENT
                ? JSON.stringify(input.gmiInput.content)
                : '';
        const selection = selectPromptProfile(input.promptProfileConfig, {
            conversationId: input.conversationContext.sessionId,
            mode: input.modeForRouting,
            userMessage,
            didCompact: input.didCompact,
        }, previousState);
        input.conversationContext.setMetadata('promptProfileState', selection.nextState);
        return selection.result;
    }
    catch (routerError) {
        console.warn('Prompt-profile routing failed (continuing without it).', routerError);
        return null;
    }
}
//# sourceMappingURL=prompt-profile.js.map