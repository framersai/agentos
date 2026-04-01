/**
 * @file IStructuredOutputManager.ts
 * @description Interface for the Structured Output Manager in AgentOS.
 *
 * The Structured Output Manager ensures LLM outputs conform to predefined
 * schemas, enabling reliable parsing, validation, and type-safe consumption
 * of agent responses. This is critical for:
 *
 * - **Tool Calls**: Ensuring function arguments match expected types
 * - **Data Extraction**: Pulling structured data from unstructured text
 * - **API Responses**: Generating responses that match API contracts
 * - **Multi-step Workflows**: Reliable data flow between pipeline stages
 *
 * Supports multiple output strategies:
 * - JSON Mode (OpenAI, Anthropic)
 * - Function Calling / Tool Use
 * - Grammar-constrained generation (local models)
 * - Post-hoc parsing with retry
 *
 * @module AgentOS/Structured
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const manager = new StructuredOutputManager(llmProvider);
 *
 * // Define a schema for extraction
 * const personSchema: JSONSchema = {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string' },
 *     age: { type: 'integer', minimum: 0 },
 *     email: { type: 'string', format: 'email' },
 *   },
 *   required: ['name', 'email'],
 * };
 *
 * // Extract structured data
 * const result = await manager.generate({
 *   prompt: 'Extract person info from: John Doe, 30 years old, john@example.com',
 *   schema: personSchema,
 *   schemaName: 'Person',
 * });
 *
 * console.log(result.data); // { name: 'John Doe', age: 30, email: 'john@example.com' }
 * ```
 */
/**
 * Error thrown when structured output generation fails.
 */
export class StructuredOutputError extends Error {
    constructor(message, validationErrors, rawOutput, retryCount, strategy) {
        super(message);
        this.name = 'StructuredOutputError';
        this.validationErrors = validationErrors;
        this.rawOutput = rawOutput;
        this.retryCount = retryCount;
        this.strategy = strategy;
    }
    /**
     * Converts error to a plain object for serialization.
     */
    toPlainObject() {
        return {
            name: this.name,
            message: this.message,
            validationErrors: this.validationErrors,
            rawOutput: this.rawOutput.substring(0, 500), // Truncate for safety
            retryCount: this.retryCount,
            strategy: this.strategy,
        };
    }
}
//# sourceMappingURL=IStructuredOutputManager.js.map