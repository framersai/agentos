/**
 * @fileoverview Prompt profile routing phase.
 * Selects a prompt profile (concise/deep/planner/reviewer) based on conversation state.
 */
import type { ConversationContext } from '../../../core/conversation/ConversationContext';
import { type PromptProfileConfig } from '../../../structured/prompting/PromptProfileRouter.js';
import { type GMITurnInput } from '../../../cognitive_substrate/IGMI';
export interface PromptProfilePhaseInput {
    conversationContext: ConversationContext | undefined;
    promptProfileConfig: PromptProfileConfig | null;
    modeForRouting: string;
    gmiInput: GMITurnInput;
    didCompact: boolean;
}
export interface PromptProfileSelection {
    presetId: string;
    systemInstructions?: string;
    reason?: string;
}
export type PromptProfilePhaseResult = PromptProfileSelection | null;
export declare function executePromptProfilePhase(input: PromptProfilePhaseInput): PromptProfilePhaseResult;
//# sourceMappingURL=prompt-profile.d.ts.map