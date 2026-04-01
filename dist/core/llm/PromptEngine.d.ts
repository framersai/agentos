/**
 * @fileoverview Implements the sophisticated PromptEngine that serves as the core of
 * AgentOS's adaptive and contextual prompting system. This implementation provides
 * intelligent prompt construction with dynamic contextual element selection,
 * token budgeting, multi-modal content integration, and optimization strategies.
 *
 * The PromptEngine orchestrates the entire prompt construction pipeline:
 * 1. Context Analysis: Evaluates execution context against persona-defined criteria.
 * 2. Element Selection: Dynamically selects applicable contextual prompt elements.
 * 3. Content Augmentation: Integrates selected elements with base prompt components.
 * 4. Token Management: Applies intelligent budgeting and content optimization.
 * 5. Template Formatting: Renders final prompts using model-specific templates.
 * 6. Quality Assurance: Validates output and reports issues/optimizations.
 *
 * @module backend/agentos/core/llm/PromptEngine
 * @implements {IPromptEngine}
 */
import { IPromptEngine, PromptEngineConfig, PromptComponents, ModelTargetInfo, PromptExecutionContext, PromptEngineResult, PromptTemplateFunction, IPromptEngineUtilityAI } from './IPromptEngine';
import { ContextualPromptElementCriteria } from '../../cognitive_substrate/personas/IPersonaDefinition';
/**
 * Comprehensive implementation of the IPromptEngine interface, providing
 * sophisticated adaptive prompting capabilities for AgentOS GMIs.
 *
 * @class PromptEngine
 * @implements {IPromptEngine}
 */
export declare class PromptEngine implements IPromptEngine {
    private config;
    private utilityAI?;
    private isInitialized;
    /**
     * Current execution context used implicitly for operations (e.g., tool manifest filtering) when
     * a context is not passed directly. This is set via `setCurrentExecutionContext` by orchestration layers.
     * Avoids leaking context through multiple method signatures while still enabling persona-scoped behavior.
     */
    private currentExecutionContext?;
    private cache;
    private statistics;
    private readonly defaultTemplates;
    constructor();
    initialize(config: PromptEngineConfig, utilityAI?: IPromptEngineUtilityAI): Promise<void>;
    /**
     * Sets the current execution context for implicit persona-aware operations (e.g., tool filtering).
     * Passing undefined clears the context.
     */
    setCurrentExecutionContext(ctx?: Readonly<PromptExecutionContext>): void;
    private ensureInitialized;
    private getInitialStatistics;
    constructPrompt(baseComponents: Readonly<PromptComponents>, modelTargetInfo: Readonly<ModelTargetInfo>, executionContext?: Readonly<PromptExecutionContext>, templateName?: string): Promise<PromptEngineResult>;
    evaluateCriteria(criteria: Readonly<ContextualPromptElementCriteria>, context: Readonly<PromptExecutionContext>): Promise<boolean>;
    estimateTokenCount(content: string, modelId?: string): Promise<number>;
    registerTemplate(templateName: string, templateFunction: PromptTemplateFunction): Promise<void>;
    validatePromptConfiguration(components: Readonly<PromptComponents>, modelTargetInfo: Readonly<ModelTargetInfo>, executionContext?: Readonly<PromptExecutionContext>): Promise<{
        isValid: boolean;
        issues: Array<{
            type: 'error' | 'warning';
            code: string;
            message: string;
            suggestion?: string;
            component?: string;
        }>;
        recommendations?: string[];
    }>;
    clearCache(selectivePattern?: string): Promise<void>;
    getEngineStatistics(): Promise<{
        totalPromptsConstructed: number;
        averageConstructionTimeMs: number;
        cacheStats: {
            hits: number;
            misses: number;
            currentSize: number;
            maxSize?: number;
            effectivenessRatio: number;
        };
        tokenCountingStats: {
            operations: number;
            averageAccuracy?: number;
        };
        contextualElementUsage: Record<string, {
            count: number;
            averageEvaluationTimeMs?: number;
        }>;
        errorRatePerType: Record<string, number>;
        performanceTimers: Record<string, {
            count: number;
            totalTimeMs: number;
            averageTimeMs: number;
        }>;
    }>;
    private validateEngineConfiguration;
    private generateCacheKey;
    private setupCacheEviction;
    private startPerformanceTimer;
    private recordPerformanceTimer;
    private augmentBaseComponents;
    private buildUserPreferencePrompts;
    private normalizeVerbosityPreference;
    private normalizePreferredFormatPreference;
    private buildUserPreferenceCacheKey;
    private applyTokenBudget;
    private calculateTotalTokens;
    private calculateTokensForMessages;
    private truncateMessages;
    private formatToolSchemasForModel;
    private buildToolDefinition;
    private serializeToolArguments;
    private normalizeToolCalls;
    private createOpenAIChatTemplate;
    private createAnthropicMessagesTemplate;
    private createGenericCompletionTemplate;
}
//# sourceMappingURL=PromptEngine.d.ts.map