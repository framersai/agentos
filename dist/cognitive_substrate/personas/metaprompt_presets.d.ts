/**
 * @fileoverview Metaprompt Presets - Pre-configured metaprompts for common scenarios
 * @module @framers/agentos/cognitive_substrate/personas/metaprompt_presets
 *
 * Provides 5 preset metaprompt configurations that respond to user emotional states:
 * 1. gmi_frustration_recovery - Responds to frustrated users
 * 2. gmi_confusion_clarification - Responds to confused users
 * 3. gmi_satisfaction_reinforcement - Responds to satisfied users
 * 4. gmi_error_recovery - Responds to error accumulation
 * 5. gmi_engagement_boost - Responds to low engagement
 */
import type { MetaPromptDefinition } from './IPersonaDefinition.js';
/**
 * Preset: Frustration Recovery
 *
 * Triggered when: User shows frustration (negative sentiment with high intensity)
 * Actions: Switch to empathetic mood, simplify approach, offer alternatives
 */
export declare const METAPROMPT_FRUSTRATION_RECOVERY: MetaPromptDefinition;
/**
 * Preset: Confusion Clarification
 *
 * Triggered when: User shows confusion (confusion keywords or neutral with negative signals)
 * Actions: Rephrase, clarify assumptions, provide examples
 */
export declare const METAPROMPT_CONFUSION_CLARIFICATION: MetaPromptDefinition;
/**
 * Preset: Satisfaction Reinforcement
 *
 * Triggered when: User shows satisfaction (positive sentiment with high intensity)
 * Actions: Increase complexity, maintain engagement, build on success
 */
export declare const METAPROMPT_SATISFACTION_REINFORCEMENT: MetaPromptDefinition;
/**
 * Preset: Error Recovery
 *
 * Triggered when: Multiple errors occur in recent turns
 * Actions: Analyze error patterns, adjust approach, implement mitigation
 */
export declare const METAPROMPT_ERROR_RECOVERY: MetaPromptDefinition;
/**
 * Preset: Engagement Boost
 *
 * Triggered when: Low engagement detected (consecutive neutral sentiment with short responses)
 * Actions: Inject creativity, change mood, ask engaging questions
 */
export declare const METAPROMPT_ENGAGEMENT_BOOST: MetaPromptDefinition;
/**
 * All preset metaprompts in a single array.
 * Makes it easy to iterate or merge with persona-specific metaprompts.
 */
export declare const ALL_METAPROMPT_PRESETS: MetaPromptDefinition[];
/**
 * Merges preset metaprompts with persona-specific metaprompts.
 *
 * Persona-defined metaprompts take precedence over presets when IDs match.
 * This allows personas to override preset behavior for specific scenarios.
 *
 * @param personaMetaPrompts - Metaprompts defined in persona configuration
 * @param includePresets - Which presets to include (default: all)
 * @returns Merged array of metaprompts with persona overrides applied
 *
 * @example
 * ```typescript
 * const mergedMetaPrompts = mergeMetapromptPresets(
 *   persona.metaPrompts,
 *   ['gmi_frustration_recovery', 'gmi_confusion_clarification']
 * );
 * ```
 */
export declare function mergeMetapromptPresets(personaMetaPrompts?: MetaPromptDefinition[], includePresets?: string[]): MetaPromptDefinition[];
/**
 * Gets a preset metaprompt by ID.
 *
 * @param id - Metaprompt ID
 * @returns Preset metaprompt or undefined if not found
 */
export declare function getPresetMetaprompt(id: string): MetaPromptDefinition | undefined;
/**
 * Checks if a metaprompt ID is a preset.
 *
 * @param id - Metaprompt ID to check
 * @returns True if the ID matches a preset
 */
export declare function isPresetMetaprompt(id: string): boolean;
//# sourceMappingURL=metaprompt_presets.d.ts.map