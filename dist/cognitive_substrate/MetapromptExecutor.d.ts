/**
 * @fileoverview Handles metaprompt trigger checking, routing, execution, and
 * state application for the GMI.
 *
 * Supports three trigger types: `turn_interval` (periodic), `event_based`
 * (driven by SentimentTracker events), and `manual` (flags in working memory).
 * Includes pre-built handlers for frustration recovery, confusion clarification,
 * satisfaction reinforcement, error recovery, engagement boost, and trait
 * adjustment, plus a generic handler for custom metaprompts.
 *
 * Extracted from GMI.ts to isolate metaprompt lifecycle concerns from the core
 * cognitive engine while preserving full feature parity.
 *
 * @module cognitive_substrate/MetapromptExecutor
 */
import { ChatMessage } from '../core/llm/providers/IProvider';
import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import { IUtilityAI } from '../nlp/ai_utilities/IUtilityAI';
import { IWorkingMemory } from './memory/IWorkingMemory';
import { GMIMood, GMIPrimeState, UserContext, TaskContext, ReasoningTraceEntry } from './IGMI';
import type { IPersonaDefinition, MetaPromptDefinition } from './personas/IPersonaDefinition';
import { GMIEventType, GMIEvent } from './GMIEvent.js';
/**
 * Configuration for the MetapromptExecutor, providing all required dependencies
 * via callbacks to avoid direct coupling to GMI internals.
 */
export interface MetapromptExecutorConfig {
    /** Working memory for persisting turn counters and reading sentiment history. */
    workingMemory: IWorkingMemory;
    /** LLM provider manager for executing metaprompt LLM calls. */
    llmProviderManager: AIModelProviderManager;
    /** AI utility service for JSON parsing with LLM recovery. */
    utilityAI: IUtilityAI;
    /** Callback returning the active persona definition. */
    getPersona: () => IPersonaDefinition;
    /** Callback to add entries to the GMI's reasoning trace. */
    addTraceEntry: (type: string, message: string, details?: Record<string, any>) => void;
    /** Callback to determine model and provider for an internal LLM call. */
    getModelAndProvider: (preferredModel?: string, preferredProvider?: string) => {
        modelId: string;
        providerId: string;
    };
    /** Callback invoked when a metaprompt updates the GMI's mood. */
    onMoodUpdate: (mood: GMIMood) => void;
    /** Callback invoked when a metaprompt updates the user context. */
    onUserContextUpdate: (updates: Partial<UserContext>) => void;
    /** Callback invoked when a metaprompt updates the task context. */
    onTaskContextUpdate: (updates: Partial<TaskContext>) => void;
    /** Callback to encode a memory imprint via the cognitive memory bridge. */
    onMemoryImprint: (content: string, tags: string[]) => Promise<void>;
    /** Callback returning the set of pending GMI event types. */
    getPendingEvents: () => Set<GMIEventType>;
    /** Callback returning the event history buffer. */
    getEventHistory: () => readonly GMIEvent[];
    /** Callback returning the current conversation history. */
    getConversationHistory: () => readonly ChatMessage[];
    /** Callback returning recent reasoning trace entries. */
    getReasoningTraceEntries: () => readonly ReasoningTraceEntry[];
    /** Callback returning the current GMI mood. */
    getMood: () => GMIMood;
    /** Callback returning the current user context. */
    getUserContext: () => UserContext;
    /** Callback returning the current task context. */
    getTaskContext: () => TaskContext;
    /** Callback to set the GMI's operational state. */
    setState: (state: GMIPrimeState) => void;
    /** Callback returning the current GMI operational state. */
    getState: () => GMIPrimeState;
    /** Callback returning the GMI instance ID (for logging). */
    getGmiId: () => string;
}
/**
 * Handles metaprompt trigger checking, execution, and state application.
 *
 * Owns the `metaPromptTriggerCounters` map and the `selfReflectionIntervalTurns`
 * / `turnsSinceLastReflection` counters (though the latter are not currently
 * incremented by the executor itself — the GMI's turn loop still manages them).
 *
 * All GMI state mutations flow back through callbacks so the executor never
 * directly mutates GMI internals.
 */
export declare class MetapromptExecutor {
    private readonly config;
    /** Per-metaprompt turn counters for `turn_interval` triggers. */
    private metaPromptTriggerCounters;
    /** Self-reflection interval (turns between reflections). */
    selfReflectionIntervalTurns: number;
    /** Turns elapsed since the last self-reflection. */
    turnsSinceLastReflection: number;
    /**
     * Creates a new MetapromptExecutor.
     *
     * @param config - All dependencies and callbacks.
     */
    constructor(config: MetapromptExecutorConfig);
    /**
     * Checks all metaprompt triggers and executes any that fire.
     *
     * Iterates through the persona's metaprompt definitions, evaluating each
     * trigger type:
     * - `turn_interval`: increments a counter and fires when the interval is reached.
     * - `event_based`: fires if the event type is in the pending events set.
     * - `manual`: fires if a flag was set in working memory.
     *
     * Triggered metaprompts are executed in parallel via `Promise.allSettled`.
     * Execution errors are logged but do not block the turn.
     *
     * @param turnId - The current turn identifier (for tracing).
     */
    checkAndTriggerMetaprompts(turnId: string): Promise<void>;
    /**
     * Gets the turn counter for a specific metaprompt.
     *
     * Checks the in-memory map first, then falls back to working memory for
     * persistence across GMI instances.
     *
     * @param metapromptId - The metaprompt identifier.
     * @returns The current counter value.
     */
    getMetapromptTurnCounter(metapromptId: string): Promise<number>;
    /**
     * Increments the turn counter for a specific metaprompt.
     *
     * @param metapromptId - The metaprompt identifier.
     */
    incrementMetapromptTurnCounter(metapromptId: string): Promise<void>;
    /**
     * Resets the turn counter for a specific metaprompt to zero.
     *
     * @param metapromptId - The metaprompt identifier.
     */
    resetMetapromptTurnCounter(metapromptId: string): Promise<void>;
    /**
     * Executes multiple metaprompts in parallel using `Promise.allSettled`.
     *
     * Transitions the GMI to REFLECTING state during execution, restoring the
     * previous state afterwards.
     *
     * @param metaPrompts - The metaprompt definitions to execute.
     */
    executeMetaprompts(metaPrompts: MetaPromptDefinition[]): Promise<void>;
    /**
     * Routes a metaprompt to its appropriate handler based on its ID.
     *
     * Known IDs have dedicated handlers; unknown IDs fall through to the
     * generic handler.
     *
     * @param metaPrompt - The metaprompt definition to execute.
     */
    executeMetapromptHandler(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Handler for the trait adjustment metaprompt (self-reflection).
     *
     * Gathers recent conversation history, reasoning trace, mood, and contexts
     * as evidence, then executes the metaprompt template with variable substitution.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleTraitAdjustment(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Handler for the frustration recovery metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleFrustrationRecovery(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Handler for the confusion clarification metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleConfusionClarification(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Handler for the satisfaction reinforcement metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleSatisfactionReinforcement(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Handler for the error recovery metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleErrorRecovery(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Handler for the engagement boost metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleEngagementBoost(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Generic handler for custom metaprompts that don't have a dedicated handler.
     *
     * Provides all available context variables for maximum flexibility.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    handleGenericMetaprompt(metaPrompt: MetaPromptDefinition): Promise<void>;
    /**
     * Executes a metaprompt template with variable substitution and LLM call.
     *
     * 1. Extracts the template string from the metaprompt definition.
     * 2. Substitutes `{{variable}}` placeholders with provided values.
     * 3. Calls the LLM with JSON response format.
     * 4. Parses the JSON response with LLM-based recovery via IUtilityAI.
     *
     * @param metaPrompt - The metaprompt definition.
     * @param variables - Key-value pairs to substitute into the template.
     * @returns The parsed JSON response from the LLM.
     */
    executeMetapromptWithVariables(metaPrompt: MetaPromptDefinition, variables: Record<string, string>): Promise<any>;
    /**
     * Applies parsed metaprompt updates to GMI state via callbacks.
     *
     * Supports mood updates, user skill level updates, task complexity updates,
     * and memory imprints. State changes are logged via the trace entry callback.
     *
     * @param updates - The parsed updates from the metaprompt LLM response.
     * @param metapromptId - The ID of the metaprompt that produced these updates.
     */
    applyMetapromptUpdates(updates: any, metapromptId: string): Promise<void>;
    /**
     * Triggers and processes a full self-reflection cycle using the
     * `gmi_self_trait_adjustment` metaprompt.
     *
     * This is the legacy public API entry point maintained for backward compatibility.
     * It performs the same work as `handleTraitAdjustment` but with additional
     * guard checks (already reflecting, no metaprompt defined) and explicit
     * state management.
     */
    triggerAndProcessSelfReflection(): Promise<void>;
}
//# sourceMappingURL=MetapromptExecutor.d.ts.map