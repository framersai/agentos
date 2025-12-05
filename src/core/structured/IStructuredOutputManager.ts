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

import type { ILogger } from '../../logging/ILogger';

// ============================================================================
// JSON Schema Types
// ============================================================================

/**
 * JSON Schema type definitions for structured output validation.
 * Follows JSON Schema Draft 2020-12 specification.
 *
 * @see https://json-schema.org/draft/2020-12/json-schema-core
 */
export type JSONSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

/**
 * String format validators supported by the schema.
 */
export type JSONSchemaStringFormat =
  | 'date-time'
  | 'date'
  | 'time'
  | 'email'
  | 'uri'
  | 'uri-reference'
  | 'uuid'
  | 'hostname'
  | 'ipv4'
  | 'ipv6'
  | 'regex';

/**
 * Complete JSON Schema definition for structured outputs.
 *
 * @remarks
 * This interface supports the commonly used JSON Schema keywords
 * for defining structured LLM outputs. It's designed to be compatible
 * with OpenAI's structured output API and similar implementations.
 */
export interface JSONSchema {
  /** The data type of the schema */
  type?: JSONSchemaType | JSONSchemaType[];

  /** Human-readable title for the schema */
  title?: string;

  /** Description of what the schema represents */
  description?: string;

  /** Default value if not provided */
  default?: unknown;

  /** Enumeration of allowed values */
  enum?: unknown[];

  /** Constant value (must be exactly this) */
  const?: unknown;

  // String constraints
  /** Minimum string length */
  minLength?: number;
  /** Maximum string length */
  maxLength?: number;
  /** Regex pattern the string must match */
  pattern?: string;
  /** String format validator */
  format?: JSONSchemaStringFormat;

  // Number constraints
  /** Minimum value (inclusive) */
  minimum?: number;
  /** Maximum value (inclusive) */
  maximum?: number;
  /** Minimum value (exclusive) */
  exclusiveMinimum?: number;
  /** Maximum value (exclusive) */
  exclusiveMaximum?: number;
  /** Value must be a multiple of this number */
  multipleOf?: number;

  // Array constraints
  /** Schema for array items */
  items?: JSONSchema | JSONSchema[];
  /** Minimum number of items */
  minItems?: number;
  /** Maximum number of items */
  maxItems?: number;
  /** All items must be unique */
  uniqueItems?: boolean;
  /** Schema for items after `items` tuple schemas */
  additionalItems?: boolean | JSONSchema;
  /** Prefix items (for tuple validation) */
  prefixItems?: JSONSchema[];
  /** Schema that must validate at least one item */
  contains?: JSONSchema;

  // Object constraints
  /** Property definitions for object */
  properties?: Record<string, JSONSchema>;
  /** Required property names */
  required?: string[];
  /** Schema for properties not in `properties` */
  additionalProperties?: boolean | JSONSchema;
  /** Pattern-based property schemas */
  patternProperties?: Record<string, JSONSchema>;
  /** Minimum number of properties */
  minProperties?: number;
  /** Maximum number of properties */
  maxProperties?: number;
  /** Property names must match this schema */
  propertyNames?: JSONSchema;
  /** Dependencies between properties */
  dependentRequired?: Record<string, string[]>;
  /** Schema dependencies */
  dependentSchemas?: Record<string, JSONSchema>;

  // Composition
  /** Must match all schemas */
  allOf?: JSONSchema[];
  /** Must match at least one schema */
  anyOf?: JSONSchema[];
  /** Must match exactly one schema */
  oneOf?: JSONSchema[];
  /** Must not match this schema */
  not?: JSONSchema;
  /** Conditional schema application */
  if?: JSONSchema;
  /** Schema if `if` passes */
  then?: JSONSchema;
  /** Schema if `if` fails */
  else?: JSONSchema;

  // References
  /** Reference to another schema */
  $ref?: string;
  /** Schema definitions for $ref */
  $defs?: Record<string, JSONSchema>;

  // Metadata
  /** Examples of valid values */
  examples?: unknown[];
  /** Whether this value is read-only */
  readOnly?: boolean;
  /** Whether this value is write-only */
  writeOnly?: boolean;
  /** Deprecation flag */
  deprecated?: boolean;
}

// ============================================================================
// Generation Options
// ============================================================================

/**
 * Strategy for enforcing structured output.
 */
export type StructuredOutputStrategy =
  | 'json_mode'           // Use provider's native JSON mode
  | 'function_calling'    // Use function/tool calling API
  | 'grammar'             // Use grammar-constrained generation
  | 'prompt_engineering'  // Instruct in prompt + parse output
  | 'auto';               // Automatically select best strategy

/**
 * Options for structured output generation.
 */
export interface StructuredGenerationOptions {
  /** The prompt or messages to send to the LLM */
  prompt: string | Array<{ role: string; content: string }>;

  /** JSON Schema the output must conform to */
  schema: JSONSchema;

  /** Human-readable name for the schema (used in function calling) */
  schemaName: string;

  /** Description of what output is expected */
  schemaDescription?: string;

  /** Strategy for enforcing structure */
  strategy?: StructuredOutputStrategy;

  /** LLM provider to use */
  providerId?: string;

  /** Model ID to use */
  modelId?: string;

  /** Temperature for generation (0-2) */
  temperature?: number;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Number of retry attempts on validation failure */
  maxRetries?: number;

  /** Whether to include reasoning/chain-of-thought before output */
  includeReasoning?: boolean;

  /** Custom system prompt to prepend */
  systemPrompt?: string;

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Whether to strictly enforce schema (fail on extra properties) */
  strict?: boolean;

  /** Custom validation function for additional checks */
  customValidator?: (data: unknown) => ValidationIssue[];
}

/**
 * Options for parallel function/tool calls.
 */
export interface ParallelFunctionCallOptions {
  /** The prompt requesting actions */
  prompt: string | Array<{ role: string; content: string }>;

  /** Available functions/tools the model can call */
  functions: FunctionDefinition[];

  /** Maximum number of parallel calls allowed */
  maxParallelCalls?: number;

  /** Whether functions are required or optional */
  toolChoice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };

  /** LLM provider to use */
  providerId?: string;

  /** Model ID to use */
  modelId?: string;

  /** Temperature for generation */
  temperature?: number;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Definition of a callable function/tool.
 */
export interface FunctionDefinition {
  /** Unique function name */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for function parameters */
  parameters: JSONSchema;

  /** Whether this function is required */
  required?: boolean;

  /** Function handler (for execution) */
  handler?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

// ============================================================================
// Results
// ============================================================================

/**
 * Result of structured output generation.
 *
 * @typeParam T - The expected type of the parsed data
 */
export interface StructuredGenerationResult<T = unknown> {
  /** Whether generation and validation succeeded */
  success: boolean;

  /** The parsed, validated data (if successful) */
  data?: T;

  /** Raw string output from the LLM */
  rawOutput: string;

  /** Validation errors if any */
  validationErrors?: ValidationIssue[];

  /** The strategy that was used */
  strategyUsed: StructuredOutputStrategy;

  /** Number of retry attempts made */
  retryCount: number;

  /** Token usage statistics */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** Generation latency in milliseconds */
  latencyMs: number;

  /** Reasoning/chain-of-thought if requested */
  reasoning?: string;

  /** Model that was used */
  modelId: string;

  /** Provider that was used */
  providerId: string;
}

/**
 * A single validation issue found during schema validation.
 */
export interface ValidationIssue {
  /** JSON Pointer path to the invalid value */
  path: string;

  /** Error message describing the issue */
  message: string;

  /** The keyword that failed validation */
  keyword: string;

  /** Expected value or constraint */
  expected?: unknown;

  /** Actual value that was found */
  actual?: unknown;

  /** Severity of the issue */
  severity: 'error' | 'warning';
}

/**
 * Result of parallel function calls.
 */
export interface ParallelFunctionCallResult {
  /** Whether all function calls were successful */
  success: boolean;

  /** Individual function call results */
  calls: FunctionCallResult[];

  /** Any content output alongside function calls */
  textContent?: string;

  /** Token usage statistics */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** Generation latency in milliseconds */
  latencyMs: number;

  /** Model that was used */
  modelId: string;

  /** Provider that was used */
  providerId: string;
}

/**
 * Result of a single function call.
 */
export interface FunctionCallResult {
  /** Function that was called */
  functionName: string;

  /** Arguments passed to the function */
  arguments: Record<string, unknown>;

  /** Whether arguments validated against schema */
  argumentsValid: boolean;

  /** Validation errors for arguments */
  validationErrors?: ValidationIssue[];

  /** Result of executing the function (if handler provided) */
  executionResult?: unknown;

  /** Error during execution (if any) */
  executionError?: string;

  /** Unique ID for this call (for multi-turn conversations) */
  callId: string;
}

// ============================================================================
// Extraction Helpers
// ============================================================================

/**
 * Options for entity extraction from text.
 */
export interface EntityExtractionOptions {
  /** Text to extract entities from */
  text: string;

  /** Schema defining the entities to extract */
  entitySchema: JSONSchema;

  /** Name for the extraction task */
  taskName: string;

  /** Additional context or instructions */
  instructions?: string;

  /** Examples of expected extractions */
  examples?: Array<{ input: string; output: unknown }>;

  /** LLM provider to use */
  providerId?: string;

  /** Model ID to use */
  modelId?: string;

  /** Whether to extract all occurrences or just first */
  extractAll?: boolean;
}

/**
 * Result of entity extraction.
 */
export interface EntityExtractionResult<T = unknown> {
  /** Whether extraction succeeded */
  success: boolean;

  /** Extracted entities */
  entities: T[];

  /** Confidence scores for each entity (0-1) */
  confidenceScores?: number[];

  /** Source text spans for each entity */
  sourceSpans?: Array<{ start: number; end: number; text: string }>;

  /** Any extraction issues */
  issues?: string[];

  /** Token usage */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ============================================================================
// Manager Interface
// ============================================================================

/**
 * Statistics about structured output operations.
 */
export interface StructuredOutputStats {
  /** Total generation attempts */
  totalGenerations: number;

  /** Successful generations */
  successfulGenerations: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Average retries per generation */
  avgRetries: number;

  /** Average latency in ms */
  avgLatencyMs: number;

  /** Generations by strategy */
  byStrategy: Record<StructuredOutputStrategy, number>;

  /** Most common validation errors */
  topValidationErrors: Array<{ keyword: string; count: number }>;

  /** Total tokens used */
  totalTokensUsed: number;
}

/**
 * Interface for the Structured Output Manager.
 *
 * The Structured Output Manager provides a unified API for generating
 * LLM outputs that conform to predefined JSON Schemas. It handles:
 *
 * - **Strategy Selection**: Choosing the best approach for the provider/model
 * - **Schema Validation**: Ensuring outputs match the schema
 * - **Retry Logic**: Automatic retries with feedback on validation failures
 * - **Function Calling**: Parallel tool use with argument validation
 * - **Entity Extraction**: Pulling structured data from unstructured text
 *
 * @example
 * ```typescript
 * // Simple structured generation
 * const result = await manager.generate({
 *   prompt: 'List the top 3 programming languages',
 *   schema: {
 *     type: 'object',
 *     properties: {
 *       languages: {
 *         type: 'array',
 *         items: {
 *           type: 'object',
 *           properties: {
 *             name: { type: 'string' },
 *             popularity: { type: 'integer', minimum: 1, maximum: 100 },
 *           },
 *           required: ['name', 'popularity'],
 *         },
 *         minItems: 3,
 *         maxItems: 3,
 *       },
 *     },
 *     required: ['languages'],
 *   },
 *   schemaName: 'ProgrammingLanguages',
 * });
 *
 * if (result.success) {
 *   result.data.languages.forEach(lang => {
 *     console.log(`${lang.name}: ${lang.popularity}%`);
 *   });
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Parallel function calling
 * const result = await manager.generateFunctionCalls({
 *   prompt: 'Search for weather in NYC and stock price of AAPL',
 *   functions: [
 *     {
 *       name: 'get_weather',
 *       description: 'Get current weather for a city',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           city: { type: 'string' },
 *           units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
 *         },
 *         required: ['city'],
 *       },
 *       handler: async (args) => fetchWeather(args.city, args.units),
 *     },
 *     {
 *       name: 'get_stock_price',
 *       description: 'Get current stock price',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           symbol: { type: 'string' },
 *         },
 *         required: ['symbol'],
 *       },
 *       handler: async (args) => fetchStockPrice(args.symbol),
 *     },
 *   ],
 *   maxParallelCalls: 5,
 * });
 *
 * // Both functions called in parallel
 * result.calls.forEach(call => {
 *   console.log(`${call.functionName}: ${JSON.stringify(call.executionResult)}`);
 * });
 * ```
 */
export interface IStructuredOutputManager {
  /**
   * Initializes the manager with optional configuration.
   *
   * @param logger - Logger instance for debugging
   */
  initialize(logger?: ILogger): Promise<void>;

  /**
   * Generates structured output conforming to the given schema.
   *
   * @typeParam T - Expected type of the output data
   * @param options - Generation options including prompt and schema
   * @returns Promise resolving to the generation result
   *
   * @throws {StructuredOutputError} If generation fails after all retries
   *
   * @example
   * ```typescript
   * const result = await manager.generate<Person>({
   *   prompt: 'Extract person info from: John Doe, 30, john@example.com',
   *   schema: personSchema,
   *   schemaName: 'Person',
   *   strict: true,
   * });
   *
   * if (result.success) {
   *   console.log(result.data.name); // Type-safe access
   * }
   * ```
   */
  generate<T = unknown>(options: StructuredGenerationOptions): Promise<StructuredGenerationResult<T>>;

  /**
   * Generates parallel function/tool calls.
   *
   * This method enables the LLM to call multiple functions in a single
   * response, useful for parallel data fetching or multi-step operations.
   *
   * @param options - Function call options
   * @returns Promise resolving to function call results
   *
   * @example
   * ```typescript
   * const result = await manager.generateFunctionCalls({
   *   prompt: 'Get the weather in Paris and London',
   *   functions: [weatherFunction],
   *   maxParallelCalls: 10,
   * });
   *
   * // Execute all calls in parallel
   * await Promise.all(result.calls.map(async call => {
   *   const fn = functions.find(f => f.name === call.functionName);
   *   if (fn?.handler) {
   *     call.executionResult = await fn.handler(call.arguments);
   *   }
   * }));
   * ```
   */
  generateFunctionCalls(options: ParallelFunctionCallOptions): Promise<ParallelFunctionCallResult>;

  /**
   * Extracts structured entities from unstructured text.
   *
   * Useful for NER, data extraction, and information retrieval tasks.
   *
   * @typeParam T - Expected type of extracted entities
   * @param options - Extraction options
   * @returns Promise resolving to extraction results
   *
   * @example
   * ```typescript
   * const result = await manager.extractEntities<Person>({
   *   text: 'John Doe (john@example.com) met Jane Smith (jane@example.com)',
   *   entitySchema: personSchema,
   *   taskName: 'PersonExtraction',
   *   extractAll: true,
   * });
   *
   * result.entities.forEach(person => {
   *   console.log(`Found: ${person.name} - ${person.email}`);
   * });
   * ```
   */
  extractEntities<T = unknown>(options: EntityExtractionOptions): Promise<EntityExtractionResult<T>>;

  /**
   * Validates data against a JSON Schema.
   *
   * @param data - Data to validate
   * @param schema - Schema to validate against
   * @param strict - Whether to fail on additional properties
   * @returns Array of validation issues (empty if valid)
   *
   * @example
   * ```typescript
   * const issues = manager.validate(
   *   { name: 'John', age: -5 },
   *   personSchema,
   *   true
   * );
   *
   * if (issues.length > 0) {
   *   issues.forEach(issue => {
   *     console.log(`${issue.path}: ${issue.message}`);
   *   });
   * }
   * ```
   */
  validate(data: unknown, schema: JSONSchema, strict?: boolean): ValidationIssue[];

  /**
   * Parses JSON string with error recovery.
   *
   * Attempts to extract valid JSON from potentially malformed output,
   * handling common LLM output issues like:
   * - Markdown code blocks
   * - Trailing commas
   * - Unquoted keys
   * - Single quotes
   *
   * @param jsonString - String to parse
   * @returns Parsed object or null if parsing fails
   *
   * @example
   * ```typescript
   * // Handles markdown-wrapped JSON
   * const data = manager.parseJSON('```json\n{"name": "John"}\n```');
   * // Returns: { name: 'John' }
   *
   * // Handles trailing commas
   * const data2 = manager.parseJSON('{"a": 1, "b": 2,}');
   * // Returns: { a: 1, b: 2 }
   * ```
   */
  parseJSON(jsonString: string): unknown | null;

  /**
   * Determines the best strategy for a given provider/model.
   *
   * @param providerId - LLM provider ID
   * @param modelId - Model ID
   * @param schema - Schema to generate for
   * @returns Recommended strategy
   */
  recommendStrategy(providerId: string, modelId: string, schema: JSONSchema): StructuredOutputStrategy;

  /**
   * Registers a custom schema for reuse.
   *
   * @param name - Schema name for reference
   * @param schema - Schema definition
   *
   * @example
   * ```typescript
   * manager.registerSchema('Address', {
   *   type: 'object',
   *   properties: {
   *     street: { type: 'string' },
   *     city: { type: 'string' },
   *     country: { type: 'string' },
   *     postalCode: { type: 'string' },
   *   },
   *   required: ['street', 'city', 'country'],
   * });
   *
   * // Use in other schemas via $ref
   * const orderSchema = {
   *   type: 'object',
   *   properties: {
   *     shippingAddress: { $ref: '#/$defs/Address' },
   *   },
   * };
   * ```
   */
  registerSchema(name: string, schema: JSONSchema): void;

  /**
   * Gets a registered schema by name.
   *
   * @param name - Schema name
   * @returns Schema or undefined if not found
   */
  getSchema(name: string): JSONSchema | undefined;

  /**
   * Gets statistics about structured output operations.
   *
   * @returns Current statistics
   */
  getStatistics(): StructuredOutputStats;

  /**
   * Resets statistics counters.
   */
  resetStatistics(): void;
}

/**
 * Error thrown when structured output generation fails.
 */
export class StructuredOutputError extends Error {
  /** Validation issues that caused the failure */
  public readonly validationErrors: ValidationIssue[];

  /** Raw output that failed validation */
  public readonly rawOutput: string;

  /** Number of retries attempted */
  public readonly retryCount: number;

  /** Strategy that was used */
  public readonly strategy: StructuredOutputStrategy;

  constructor(
    message: string,
    validationErrors: ValidationIssue[],
    rawOutput: string,
    retryCount: number,
    strategy: StructuredOutputStrategy,
  ) {
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
  toPlainObject(): Record<string, unknown> {
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



