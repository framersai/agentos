/**
 * Exports for the Structured Output Manager in AgentOS.
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
 * } from '../../structured/output/index.js';
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
export { StructuredOutputError } from './IStructuredOutputManager.js';
// Implementation
export { StructuredOutputManager, } from './StructuredOutputManager.js';
//# sourceMappingURL=index.js.map