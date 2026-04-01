/**
 * Prompt Profile Router
 *
 * "Prompt profiles" are lightweight system-instruction presets (concise / deep dive / planner / reviewer)
 * that can be selected dynamically per-turn. This is intentionally separate from AgentOS "metaprompts",
 * which are self-reflection loops that run after turns.
 */
export interface PromptProfilePresetDefinition {
    id: string;
    label?: string;
    description?: string;
    /**
     * Optional add-on prompt keys that resolve to system instruction blocks.
     * Supported built-ins:
     * - `_meta/concise`
     * - `_meta/deep_dive`
     * - `_meta/planner`
     * - `_meta/reviewer`
     */
    addonPromptKeys?: string[];
}
export interface PromptProfileRule {
    id: string;
    priority: number;
    presetId: string;
    modes?: string[];
    anyKeywords?: string[];
    allKeywords?: string[];
    minMessageChars?: number;
    maxMessageChars?: number;
}
export interface PromptProfileConfig {
    version: string;
    routing: {
        reviewEveryNTurns: number;
        forceReviewOnCompaction: boolean;
        defaultPresetId: string;
        defaultPresetByMode?: Record<string, string>;
    };
    presets: PromptProfilePresetDefinition[];
    rules: PromptProfileRule[];
    /**
     * Optional map of add-on prompt key -> instruction block content.
     * If omitted, built-in defaults will be used for the `_meta/*` keys.
     */
    addonPrompts?: Record<string, string>;
}
export interface PromptProfileSelectionInput {
    conversationId?: string;
    mode: string;
    userMessage: string;
    didCompact?: boolean;
    forceReview?: boolean;
    now?: number;
}
export interface PromptProfileSelectionResult {
    presetId: string;
    label?: string;
    addonPromptKeys: string[];
    systemInstructions: string;
    wasReviewed: boolean;
    reason: string;
}
export interface PromptProfileConversationState {
    presetId: string;
    turnsSinceReview: number;
    lastReviewedAt: number;
}
export declare function selectPromptProfile(config: PromptProfileConfig, input: PromptProfileSelectionInput, previousState?: PromptProfileConversationState | null): {
    result: PromptProfileSelectionResult;
    nextState: PromptProfileConversationState;
};
export declare const DEFAULT_PROMPT_PROFILE_CONFIG: PromptProfileConfig;
//# sourceMappingURL=PromptProfileRouter.d.ts.map