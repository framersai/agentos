/**
 * @file Structured Output Module Index
 * @description Exports for the Structured Output Manager in AgentOS.
 *
 * The Structured Output module provides:
 * - JSON Schema validation for LLM outputs
 * - Multiple generation strategies (JSON mode, function calling, prompt engineering)
 * - Parallel function/tool calling with argument validation
 * - Entity extraction from unstructured text
 * - Robust JSON parsing with error recovery
 *
 * @module AgentOS/Structured
 *
 * @example
 * ```typescript
 * import {
 *   StructuredOutputManager,
 *   JSONSchema,
 *   StructuredGenerationOptions,
 * } from '@framers/agentos/core/structured';
 *
 * const manager = new StructuredOutputManager({ llmProviderManager });
 *
 * const result = await manager.generate({
 *   prompt: 'Extract person info from: John Doe, 30, john@example.com',
 *   schema: personSchema,
 *   schemaName: 'Person',
 * });
 * ```
 */

// Interface
export type {
  IStructuredOutputManager,
  JSONSchema,
  JSONSchemaType,
  JSONSchemaStringFormat,
  StructuredOutputStrategy,
  StructuredGenerationOptions,
  StructuredGenerationResult,
  ParallelFunctionCallOptions,
  ParallelFunctionCallResult,
  FunctionDefinition,
  FunctionCallResult,
  EntityExtractionOptions,
  EntityExtractionResult,
  ValidationIssue,
  StructuredOutputStats,
} from './IStructuredOutputManager';

export { StructuredOutputError } from './IStructuredOutputManager';

// Implementation
export {
  StructuredOutputManager,
  type StructuredOutputManagerConfig,
} from './StructuredOutputManager';


