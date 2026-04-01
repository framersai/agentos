/**
 * @file StructuredOutputManager.ts
 * @description Implementation of the Structured Output Manager for AgentOS.
 *
 * Provides robust JSON Schema validation, structured generation strategies,
 * and parallel function calling capabilities. Handles the complexity of
 * different LLM provider APIs and output formats.
 *
 * @module AgentOS/Structured
 * @version 1.0.0
 */
import type { ILogger } from '../../logging/ILogger';
import type { AIModelProviderManager } from '../../core/llm/providers/AIModelProviderManager';
import { IStructuredOutputManager, JSONSchema, StructuredGenerationOptions, StructuredGenerationResult, ParallelFunctionCallOptions, ParallelFunctionCallResult, EntityExtractionOptions, EntityExtractionResult, ValidationIssue, StructuredOutputStats, StructuredOutputStrategy } from './IStructuredOutputManager';
/**
 * Configuration options for the Structured Output Manager.
 */
export interface StructuredOutputManagerConfig {
    /** LLM provider manager for making requests */
    llmProviderManager: AIModelProviderManager;
    /** Default provider ID */
    defaultProviderId?: string;
    /** Default model ID */
    defaultModelId?: string;
    /** Default max retries */
    defaultMaxRetries?: number;
    /** Default timeout in milliseconds */
    defaultTimeoutMs?: number;
    /** Logger instance */
    logger?: ILogger;
}
/**
 * Structured Output Manager implementation.
 *
 * Provides comprehensive structured output capabilities including:
 * - JSON Schema validation with detailed error reporting
 * - Multiple generation strategies (JSON mode, function calling, prompt engineering)
 * - Automatic retry with feedback on validation failures
 * - Parallel function calling with argument validation
 * - Entity extraction from unstructured text
 * - Robust JSON parsing with error recovery
 *
 * @implements {IStructuredOutputManager}
 */
export declare class StructuredOutputManager implements IStructuredOutputManager {
    private readonly llmProviderManager;
    private readonly defaultProviderId;
    private readonly defaultModelId;
    private readonly defaultMaxRetries;
    private readonly defaultTimeoutMs;
    private logger?;
    /** Registered schemas for reuse */
    private readonly schemas;
    /** Statistics tracking */
    private stats;
    private totalRetries;
    private totalLatencyMs;
    private validationErrorCounts;
    /**
     * Creates a new StructuredOutputManager instance.
     *
     * @param config - Configuration options
     */
    constructor(config: StructuredOutputManagerConfig);
    /**
     * Initializes the manager.
     */
    initialize(logger?: ILogger): Promise<void>;
    /**
     * Generates structured output conforming to the given schema.
     */
    generate<T = unknown>(options: StructuredGenerationOptions): Promise<StructuredGenerationResult<T>>;
    /**
     * Executes a single generation attempt.
     */
    private executeGeneration;
    /**
     * Builds messages for the LLM request.
     */
    private buildMessages;
    /**
     * Generates parallel function/tool calls.
     */
    generateFunctionCalls(options: ParallelFunctionCallOptions): Promise<ParallelFunctionCallResult>;
    /**
     * Extracts structured entities from unstructured text.
     */
    extractEntities<T = unknown>(options: EntityExtractionOptions): Promise<EntityExtractionResult<T>>;
    /**
     * Validates data against a JSON Schema.
     */
    validate(data: unknown, schema: JSONSchema, strict?: boolean): ValidationIssue[];
    /**
     * Recursively validates a value against a schema.
     */
    private validateValue;
    /**
     * Gets the JSON type of a value.
     * Note: In JSON Schema, 'integer' is a subset of 'number', so integers
     * should match both 'integer' and 'number' types.
     */
    private getJSONType;
    /**
     * Checks if a value matches the expected type(s).
     */
    private matchesType;
    /**
     * Validates a string format.
     */
    private validateFormat;
    /**
     * Parses JSON string with error recovery.
     */
    parseJSON(jsonString: string): unknown | null;
    /**
     * Recommends a strategy for the given provider/model.
     */
    recommendStrategy(providerId: string, modelId: string, schema: JSONSchema): StructuredOutputStrategy;
    /**
     * Registers a schema for reuse.
     */
    registerSchema(name: string, schema: JSONSchema): void;
    /**
     * Gets a registered schema.
     */
    getSchema(name: string): JSONSchema | undefined;
    /**
     * Gets statistics about structured output operations.
     */
    getStatistics(): StructuredOutputStats;
    /**
     * Resets statistics.
     */
    resetStatistics(): void;
    /**
     * Updates derived statistics.
     */
    private updateStats;
}
//# sourceMappingURL=StructuredOutputManager.d.ts.map