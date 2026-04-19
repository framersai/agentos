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
import { GMIMood, GMIPrimeState, } from './IGMI.js';
import { GMIEventType } from './GMIEvent.js';
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '@framers/agentos/core/utils/errors';
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
export class MetapromptExecutor {
    /**
     * Creates a new MetapromptExecutor.
     *
     * @param config - All dependencies and callbacks.
     */
    constructor(config) {
        this.config = config;
        /** Per-metaprompt turn counters for `turn_interval` triggers. */
        this.metaPromptTriggerCounters = new Map();
        /** Turns elapsed since the last self-reflection. */
        this.turnsSinceLastReflection = 0;
        this.selfReflectionIntervalTurns = 5; // Will be overridden by initialize
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
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
    async checkAndTriggerMetaprompts(turnId) {
        const persona = this.config.getPersona();
        if (!persona.metaPrompts || persona.metaPrompts.length === 0) {
            return;
        }
        const triggeredMetaPrompts = [];
        const pendingEvents = this.config.getPendingEvents();
        for (const metaPrompt of persona.metaPrompts) {
            if (!metaPrompt.trigger)
                continue;
            if (metaPrompt.trigger.type === 'turn_interval') {
                const counter = await this.getMetapromptTurnCounter(metaPrompt.id);
                if (counter >= metaPrompt.trigger.intervalTurns) {
                    triggeredMetaPrompts.push(metaPrompt);
                    await this.resetMetapromptTurnCounter(metaPrompt.id);
                }
                else {
                    await this.incrementMetapromptTurnCounter(metaPrompt.id);
                }
            }
            else if (metaPrompt.trigger.type === 'event_based') {
                const eventName = metaPrompt.trigger.eventName;
                if (pendingEvents.has(eventName)) {
                    triggeredMetaPrompts.push(metaPrompt);
                    pendingEvents.delete(eventName);
                }
            }
            else if (metaPrompt.trigger.type === 'manual') {
                const manualFlag = await this.config.workingMemory.get(`manual_trigger_${metaPrompt.id}`);
                if (manualFlag) {
                    triggeredMetaPrompts.push(metaPrompt);
                    await this.config.workingMemory.delete(`manual_trigger_${metaPrompt.id}`);
                }
            }
        }
        if (triggeredMetaPrompts.length > 0) {
            this.config.addTraceEntry('SELF_REFLECTION_TRIGGERED', `${triggeredMetaPrompts.length} metaprompt(s) triggered`, { ids: triggeredMetaPrompts.map((m) => m.id), turnId });
            this.executeMetaprompts(triggeredMetaPrompts).catch((err) => {
                console.error(`GMI (ID: ${this.config.getGmiId()}): Metaprompt execution error:`, err);
                this.config.addTraceEntry('ERROR', 'Metaprompt execution failed', { error: err.message });
            });
        }
    }
    /**
     * Gets the turn counter for a specific metaprompt.
     *
     * Checks the in-memory map first, then falls back to working memory for
     * persistence across GMI instances.
     *
     * @param metapromptId - The metaprompt identifier.
     * @returns The current counter value.
     */
    async getMetapromptTurnCounter(metapromptId) {
        const counter = this.metaPromptTriggerCounters.get(metapromptId);
        if (counter !== undefined) {
            return counter;
        }
        const storedCounter = await this.config.workingMemory.get(`metaprompt_turn_counter_${metapromptId}`);
        return storedCounter || 0;
    }
    /**
     * Increments the turn counter for a specific metaprompt.
     *
     * @param metapromptId - The metaprompt identifier.
     */
    async incrementMetapromptTurnCounter(metapromptId) {
        const current = await this.getMetapromptTurnCounter(metapromptId);
        const newValue = current + 1;
        this.metaPromptTriggerCounters.set(metapromptId, newValue);
        await this.config.workingMemory.set(`metaprompt_turn_counter_${metapromptId}`, newValue);
    }
    /**
     * Resets the turn counter for a specific metaprompt to zero.
     *
     * @param metapromptId - The metaprompt identifier.
     */
    async resetMetapromptTurnCounter(metapromptId) {
        this.metaPromptTriggerCounters.set(metapromptId, 0);
        await this.config.workingMemory.set(`metaprompt_turn_counter_${metapromptId}`, 0);
    }
    /**
     * Executes multiple metaprompts in parallel using `Promise.allSettled`.
     *
     * Transitions the GMI to REFLECTING state during execution, restoring the
     * previous state afterwards.
     *
     * @param metaPrompts - The metaprompt definitions to execute.
     */
    async executeMetaprompts(metaPrompts) {
        if (metaPrompts.length === 0)
            return;
        const previousState = this.config.getState();
        this.config.setState(GMIPrimeState.REFLECTING);
        this.config.addTraceEntry('SELF_REFLECTION_START', `Executing ${metaPrompts.length} metaprompt(s)`, { ids: metaPrompts.map((m) => m.id) });
        try {
            const results = await Promise.allSettled(metaPrompts.map((mp) => this.executeMetapromptHandler(mp)));
            results.forEach((result, idx) => {
                if (result.status === 'rejected') {
                    this.config.addTraceEntry('ERROR', `Metaprompt '${metaPrompts[idx].id}' failed: ${result.reason}`, { error: result.reason });
                }
            });
        }
        catch (error) {
            const gmiError = createGMIErrorFromError(error, GMIErrorCode.GMI_PROCESSING_ERROR, undefined, 'Error during metaprompt execution');
            this.config.addTraceEntry('ERROR', gmiError.message, gmiError.toPlainObject());
        }
        finally {
            const disallowedStates = new Set([
                GMIPrimeState.IDLE,
                GMIPrimeState.INITIALIZING,
            ]);
            this.config.setState(disallowedStates.has(previousState) ? GMIPrimeState.READY : previousState);
            this.config.addTraceEntry('SELF_REFLECTION_COMPLETE', 'Metaprompt execution cycle complete');
        }
    }
    /**
     * Routes a metaprompt to its appropriate handler based on its ID.
     *
     * Known IDs have dedicated handlers; unknown IDs fall through to the
     * generic handler.
     *
     * @param metaPrompt - The metaprompt definition to execute.
     */
    async executeMetapromptHandler(metaPrompt) {
        switch (metaPrompt.id) {
            case 'gmi_self_trait_adjustment':
                return this.handleTraitAdjustment(metaPrompt);
            case 'gmi_frustration_recovery':
                return this.handleFrustrationRecovery(metaPrompt);
            case 'gmi_confusion_clarification':
                return this.handleConfusionClarification(metaPrompt);
            case 'gmi_satisfaction_reinforcement':
                return this.handleSatisfactionReinforcement(metaPrompt);
            case 'gmi_error_recovery':
                return this.handleErrorRecovery(metaPrompt);
            case 'gmi_engagement_boost':
                return this.handleEngagementBoost(metaPrompt);
            default:
                return this.handleGenericMetaprompt(metaPrompt);
        }
    }
    /**
     * Handler for the trait adjustment metaprompt (self-reflection).
     *
     * Gathers recent conversation history, reasoning trace, mood, and contexts
     * as evidence, then executes the metaprompt template with variable substitution.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleTraitAdjustment(metaPrompt) {
        const evidenceHistory = this.config.getConversationHistory().slice(-10);
        const evidenceTrace = this.config.getReasoningTraceEntries().slice(-20);
        const evidence = {
            recentHistory: evidenceHistory,
            recentReasoning: evidenceTrace,
            currentMood: this.config.getMood(),
            userContext: this.config.getUserContext(),
            taskContext: this.config.getTaskContext(),
        };
        const variables = {
            evidence: JSON.stringify(evidence).substring(0, 4000),
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
    /**
     * Handler for the frustration recovery metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleFrustrationRecovery(metaPrompt) {
        const sentimentHistory = await this.config.workingMemory.get('gmi_sentiment_history');
        const recentErrors = this.config.getReasoningTraceEntries()
            .slice(-10)
            .filter((e) => e.type === 'ERROR');
        const variables = {
            current_sentiment: this.config.getUserContext().currentSentiment || 'negative',
            sentiment_score: (sentimentHistory?.trends[sentimentHistory.trends.length - 1]?.score || -0.5).toString(),
            consecutive_frustration: (sentimentHistory?.consecutiveFrustration || 1).toString(),
            recent_conversation: JSON.stringify(this.config.getConversationHistory().slice(-5)),
            recent_errors: JSON.stringify(recentErrors.map((e) => e.message)),
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
    /**
     * Handler for the confusion clarification metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleConfusionClarification(metaPrompt) {
        const sentimentHistory = await this.config.workingMemory.get('gmi_sentiment_history');
        const lastConfusionEvent = this.config.getEventHistory()
            .slice()
            .reverse()
            .find((e) => e.eventType === GMIEventType.USER_CONFUSED);
        const variables = {
            current_sentiment: this.config.getUserContext().currentSentiment || 'neutral',
            consecutive_confusion: (sentimentHistory?.consecutiveConfusion || 1).toString(),
            recent_conversation: JSON.stringify(this.config.getConversationHistory().slice(-5)),
            confusion_keywords: lastConfusionEvent?.metadata.triggerKeywords
                ? JSON.stringify(lastConfusionEvent.metadata.triggerKeywords)
                : '[]',
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
    /**
     * Handler for the satisfaction reinforcement metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleSatisfactionReinforcement(metaPrompt) {
        const sentimentHistory = await this.config.workingMemory.get('gmi_sentiment_history');
        const variables = {
            current_sentiment: this.config.getUserContext().currentSentiment || 'positive',
            sentiment_score: (sentimentHistory?.trends[sentimentHistory.trends.length - 1]?.score || 0.5).toString(),
            consecutive_satisfaction: (sentimentHistory?.consecutiveSatisfaction || 1).toString(),
            recent_conversation: JSON.stringify(this.config.getConversationHistory().slice(-5)),
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
    /**
     * Handler for the error recovery metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleErrorRecovery(metaPrompt) {
        const recentErrors = this.config.getReasoningTraceEntries()
            .slice(-10)
            .filter((e) => e.type === 'ERROR');
        const variables = {
            recent_errors: JSON.stringify(recentErrors.map((e) => ({ message: e.message, details: e.details }))),
            recent_conversation: JSON.stringify(this.config.getConversationHistory().slice(-5)),
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
    /**
     * Handler for the engagement boost metaprompt.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleEngagementBoost(metaPrompt) {
        const sentimentHistory = await this.config.workingMemory.get('gmi_sentiment_history');
        const variables = {
            consecutive_neutral: (sentimentHistory?.consecutiveConfusion || 4).toString(),
            recent_conversation: JSON.stringify(this.config.getConversationHistory().slice(-5)),
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
    /**
     * Generic handler for custom metaprompts that don't have a dedicated handler.
     *
     * Provides all available context variables for maximum flexibility.
     *
     * @param metaPrompt - The metaprompt definition.
     */
    async handleGenericMetaprompt(metaPrompt) {
        const variables = {
            recent_conversation: JSON.stringify(this.config.getConversationHistory().slice(-5)),
            recent_reasoning: JSON.stringify(this.config.getReasoningTraceEntries().slice(-10)),
            current_mood: this.config.getMood(),
            user_skill: this.config.getUserContext().skillLevel || 'unknown',
            task_complexity: this.config.getTaskContext().complexity || 'unknown',
            current_sentiment: this.config.getUserContext().currentSentiment || 'neutral',
        };
        const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
        await this.applyMetapromptUpdates(response, metaPrompt.id);
    }
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
    async executeMetapromptWithVariables(metaPrompt, variables) {
        let template;
        if (typeof metaPrompt.promptTemplate === 'string') {
            template = metaPrompt.promptTemplate;
        }
        else {
            template = metaPrompt.promptTemplate.template;
        }
        let finalPrompt = template;
        for (const [key, value] of Object.entries(variables)) {
            finalPrompt = finalPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        const persona = this.config.getPersona();
        const modelId = metaPrompt.modelId || persona.defaultModelId;
        const providerId = metaPrompt.providerId || persona.defaultProviderId;
        if (!modelId || !providerId) {
            throw new GMIError('No model or provider specified for metaprompt', GMIErrorCode.CONFIGURATION_ERROR);
        }
        this.config.addTraceEntry('DEBUG', `Executing metaprompt '${metaPrompt.id}'`, { modelId, providerId });
        const completionOptions = {
            temperature: metaPrompt.temperature ?? 0.3,
            maxTokens: metaPrompt.maxOutputTokens ?? 512,
            responseFormat: { type: 'json_object' },
        };
        const provider = this.config.llmProviderManager.getProvider(providerId);
        if (!provider) {
            throw new GMIError(`Provider '${providerId}' not found for metaprompt '${metaPrompt.id}'.`, GMIErrorCode.LLM_PROVIDER_UNAVAILABLE);
        }
        const result = await provider.generateCompletion(modelId, [{ role: 'user', content: finalPrompt }], completionOptions);
        const responseContent = result.choices?.[0]?.message?.content;
        if (!responseContent || typeof responseContent !== 'string') {
            throw new GMIError(`Metaprompt '${metaPrompt.id}' returned no valid content.`, GMIErrorCode.LLM_PROVIDER_ERROR, { response: result });
        }
        const parseOptions = {
            attemptFixWithLLM: true,
            llmModelIdForFix: modelId,
            llmProviderIdForFix: providerId,
        };
        const parsedResponse = await this.config.utilityAI.parseJsonSafe(responseContent, parseOptions);
        return parsedResponse;
    }
    /**
     * Applies parsed metaprompt updates to GMI state via callbacks.
     *
     * Supports mood updates, user skill level updates, task complexity updates,
     * and memory imprints. State changes are logged via the trace entry callback.
     *
     * @param updates - The parsed updates from the metaprompt LLM response.
     * @param metapromptId - The ID of the metaprompt that produced these updates.
     */
    async applyMetapromptUpdates(updates, metapromptId) {
        if (!updates)
            return;
        let stateChanged = false;
        // Mood update — GMIMood enum values are lowercase (e.g., 'focused'),
        // but LLM responses may return either case. Normalize to lowercase for comparison.
        if (updates.updatedGmiMood) {
            const validMoods = Object.values(GMIMood);
            const normalizedMood = String(updates.updatedGmiMood).toLowerCase();
            if (validMoods.includes(normalizedMood) && this.config.getMood() !== normalizedMood) {
                this.config.onMoodUpdate(normalizedMood);
                stateChanged = true;
            }
        }
        // User skill level update
        const userCtx = this.config.getUserContext();
        if (updates.updatedUserSkillLevel &&
            userCtx.skillLevel !== updates.updatedUserSkillLevel) {
            this.config.onUserContextUpdate({ skillLevel: updates.updatedUserSkillLevel });
            stateChanged = true;
        }
        // Task complexity update
        const taskCtx = this.config.getTaskContext();
        if (updates.updatedTaskComplexity &&
            taskCtx.complexity !== updates.updatedTaskComplexity) {
            this.config.onTaskContextUpdate({ complexity: updates.updatedTaskComplexity });
            stateChanged = true;
        }
        // Memory imprints
        if (updates.newMemoryImprints && Array.isArray(updates.newMemoryImprints)) {
            for (const imprint of updates.newMemoryImprints) {
                if (imprint.key) {
                    await this.config.workingMemory.set(imprint.key, imprint.value);
                }
            }
            if (updates.newMemoryImprints.length > 0) {
                stateChanged = true;
            }
        }
        // Log state change
        if (stateChanged) {
            this.config.addTraceEntry('STATE_CHANGE', `GMI state updated by metaprompt '${metapromptId}'`, {
                newMood: this.config.getMood(),
                newUserSkill: this.config.getUserContext().skillLevel,
                newTaskComplexity: this.config.getTaskContext().complexity,
                rationale: updates.adjustmentRationale || updates.recoveryStrategy || updates.clarificationStrategy || updates.engagementStrategy || updates.mitigationStrategy,
            });
        }
    }
    /**
     * Triggers and processes a full self-reflection cycle using the
     * `gmi_self_trait_adjustment` metaprompt.
     *
     * This is the legacy public API entry point maintained for backward compatibility.
     * It performs the same work as `handleTraitAdjustment` but with additional
     * guard checks (already reflecting, no metaprompt defined) and explicit
     * state management.
     */
    async triggerAndProcessSelfReflection() {
        const persona = this.config.getPersona();
        const reflectionMetaPromptDef = persona.metaPrompts?.find((mp) => mp.id === 'gmi_self_trait_adjustment');
        if (!reflectionMetaPromptDef?.promptTemplate) {
            this.config.addTraceEntry('SELF_REFLECTION_SKIPPED', "Self-reflection disabled or no 'gmi_self_trait_adjustment' meta-prompt.");
            return;
        }
        if (this.config.getState() === GMIPrimeState.REFLECTING) {
            this.config.addTraceEntry('SELF_REFLECTION_SKIPPED', 'Self-reflection already in progress.');
            return;
        }
        const previousState = this.config.getState();
        this.config.setState(GMIPrimeState.REFLECTING);
        this.config.addTraceEntry('SELF_REFLECTION_START', 'Starting self-reflection cycle.');
        try {
            const evidence = {
                recentConversation: this.config.getConversationHistory().slice(-10),
                recentTraceEntries: this.config.getReasoningTraceEntries().slice(-20),
                currentMood: this.config.getMood(),
                currentUserContext: this.config.getUserContext(),
                currentTaskContext: this.config.getTaskContext(),
            };
            this.config.addTraceEntry('SELF_REFLECTION_DETAIL', 'Gathered evidence for reflection.', {
                conversationSampleCount: evidence.recentConversation.length,
                traceSampleCount: evidence.recentTraceEntries.length,
            });
            let metaPromptText = typeof reflectionMetaPromptDef.promptTemplate === 'string'
                ? reflectionMetaPromptDef.promptTemplate
                : reflectionMetaPromptDef.promptTemplate.template;
            metaPromptText = metaPromptText
                .replace(/\{\{\s*evidence\s*\}\}/gi, JSON.stringify(evidence).substring(0, 4000) + '...')
                .replace(/\{\{\s*current_mood\s*\}\}/gi, this.config.getMood())
                .replace(/\{\{\s*user_skill\s*\}\}/gi, this.config.getUserContext().skillLevel || 'unknown')
                .replace(/\{\{\s*task_complexity\s*\}\}/gi, this.config.getTaskContext().complexity || 'unknown');
            this.config.addTraceEntry('SELF_REFLECTION_DETAIL', 'Constructed meta-prompt.', { preview: metaPromptText.substring(0, 100) });
            const { modelId, providerId } = this.config.getModelAndProvider(reflectionMetaPromptDef.modelId, reflectionMetaPromptDef.providerId);
            const provider = this.config.llmProviderManager.getProvider(providerId);
            if (!provider) {
                throw new GMIError(`Provider '${providerId}' not found for self-reflection.`, GMIErrorCode.LLM_PROVIDER_UNAVAILABLE);
            }
            const llmResponse = await provider.generateCompletion(modelId, [{ role: 'user', content: metaPromptText }], {
                maxTokens: reflectionMetaPromptDef.maxOutputTokens || 512,
                temperature: reflectionMetaPromptDef.temperature || 0.3,
                responseFormat: { type: 'json_object' },
            });
            const responseContent = llmResponse.choices?.[0]?.message?.content;
            if (!responseContent || typeof responseContent !== 'string') {
                throw new GMIError('Self-reflection LLM call returned no valid content.', GMIErrorCode.LLM_PROVIDER_ERROR, { response: llmResponse });
            }
            this.config.addTraceEntry('SELF_REFLECTION_DETAIL', 'LLM response for reflection received.', { preview: responseContent.substring(0, 100) });
            const parseOptions = {
                attemptFixWithLLM: true,
                llmModelIdForFix: reflectionMetaPromptDef.modelId || modelId,
                llmProviderIdForFix: reflectionMetaPromptDef.providerId || providerId,
            };
            const parsedUpdates = await this.config.utilityAI.parseJsonSafe(responseContent, parseOptions);
            if (!parsedUpdates) {
                throw new GMIError('Failed to parse/fix JSON from self-reflection LLM.', GMIErrorCode.PARSING_ERROR, { responseText: responseContent });
            }
            this.config.addTraceEntry('SELF_REFLECTION_DETAIL', 'Parsed trait update suggestions.', { suggestions: parsedUpdates });
            // Apply updates via callbacks
            await this.applyMetapromptUpdates(parsedUpdates, 'gmi_self_trait_adjustment');
            // Handle memory imprints specifically for the trace
            if (parsedUpdates.newMemoryImprints && parsedUpdates.newMemoryImprints.length > 0) {
                this.config.addTraceEntry('STATE_CHANGE', 'New memory imprints added from self-reflection.', { imprints: parsedUpdates.newMemoryImprints.map((i) => i.key) });
            }
            if (parsedUpdates.adjustmentRationale) {
                this.config.addTraceEntry('SELF_REFLECTION_DETAIL', 'Self-reflection rationale recorded.', { rationale: parsedUpdates.adjustmentRationale });
            }
        }
        catch (error) {
            const gmiError = createGMIErrorFromError(error, GMIErrorCode.GMI_PROCESSING_ERROR, undefined, 'Error during self-reflection.');
            this.config.addTraceEntry('ERROR', `Self-reflection failed: ${gmiError.message}`, gmiError.toPlainObject());
            console.error(`GMI (ID: ${this.config.getGmiId()}) self-reflection error:`, gmiError);
        }
        finally {
            const disallowedStates = new Set([
                GMIPrimeState.IDLE,
                GMIPrimeState.INITIALIZING,
            ]);
            this.config.setState(disallowedStates.has(previousState) ? GMIPrimeState.READY : previousState);
            this.config.addTraceEntry('SELF_REFLECTION_COMPLETE', 'Self-reflection cycle finished.');
        }
    }
}
//# sourceMappingURL=MetapromptExecutor.js.map