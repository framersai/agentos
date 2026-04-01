/**
 * @fileoverview ComposableToolBuilder — DSL for constructing higher-order tools
 * by chaining existing tool invocations in a sequential pipeline.
 *
 * @module @framers/agentos/emergent/ComposableToolBuilder
 *
 * Overview:
 * - Accepts a {@link ComposableToolSpec} describing a sequence of {@link ComposableStep}s.
 * - At runtime each step's `inputMapping` is resolved against a shared evaluation
 *   context consisting of the original tool input (`$input.*`), the previous step's
 *   output (`$prev.*`), and any named step output (`$steps[N].*`).
 * - Steps execute sequentially; the first failure aborts the pipeline and surfaces
 *   the error immediately.
 * - The composite tool's final output is the last step's raw output value.
 * - Safe by construction: all tool invocations are delegated to a caller-supplied
 *   `executeTool` callback, so the builder never touches an external registry directly.
 */
import type { ComposableToolSpec } from './types.js';
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
/**
 * Builds composite `ITool` instances by chaining existing tool invocations.
 *
 * Each invocation is described by a {@link ComposableStep} that maps values from
 * a shared pipeline context into the step tool's arguments via a lightweight
 * reference expression syntax:
 *
 * | Expression | Resolves to |
 * |---|---|
 * | `"$input.foo"` | `args.foo` from the composite tool's own input |
 * | `"$input"` | the whole input object |
 * | `"$prev.bar"` | `bar` from the previous step's output |
 * | `"$prev"` | the previous step's full output |
 * | `"$steps[0].output.data"` | `output.data` from the first step's output |
 * | `"$steps[0]"` | the first step's full output |
 * | anything else | used as a literal value without transformation |
 *
 * Reference expressions nested inside plain objects are resolved recursively, so
 * `{ query: "$input.topic", limit: 10 }` becomes `{ query: "actual-topic", limit: 10 }`.
 *
 * Safe by construction — all tool invocations are delegated to the `executeTool`
 * callback supplied at construction time. The builder never holds a reference to
 * any tool registry.
 *
 * @example
 * ```ts
 * const builder = new ComposableToolBuilder(async (toolName, args, ctx) => {
 *   const tool = registry.get(toolName);
 *   return tool.execute(args, ctx);
 * });
 *
 * const spec: ComposableToolSpec = {
 *   mode: 'compose',
 *   steps: [
 *     { name: 'search', tool: 'web_search', inputMapping: { query: '$input.topic' } },
 *     { name: 'summarise', tool: 'summarise_text', inputMapping: { text: '$prev.snippet' } },
 *   ],
 * };
 *
 * const tool = builder.build('research', 'Search then summarise a topic', schema, spec);
 * const result = await tool.execute({ topic: 'quantum computing' }, ctx);
 * ```
 */
export declare class ComposableToolBuilder {
    private readonly executeTool;
    /**
     * When true, unresolved `$`-prefixed reference expressions throw instead
     * of silently passing through as literal strings. Useful for development
     * and testing to catch typos in inputMapping expressions early.
     */
    readonly strictMode: boolean;
    /**
     * @param executeTool - Callback invoked for each pipeline step. Receives the
     *   target tool name, the resolved argument object, and the outer execution
     *   context forwarded from the composite tool's own `execute` call.
     *   Must return a {@link ToolExecutionResult}; a `success: false` result aborts
     *   the remainder of the pipeline.
     * @param options - Optional builder configuration.
     * @param options.strictMode - When true, unresolved reference expressions
     *   throw an error instead of falling through as literal strings.
     */
    constructor(executeTool: (toolName: string, args: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>, options?: {
        strictMode?: boolean;
    });
    /**
     * Build an `ITool`-compatible object from a {@link ComposableToolSpec}.
     *
     * The returned tool can be registered directly with any tool orchestrator that
     * accepts `ITool`. Its `execute` method runs the step pipeline sequentially,
     * threading outputs through the reference resolution system.
     *
     * @param name - Machine-readable tool name exposed to the LLM (e.g. `"research_topic"`).
     * @param description - Natural language description of what the composite tool does.
     * @param inputSchema - JSON Schema describing the arguments the composite tool accepts.
     * @param spec - The composable pipeline specification to execute.
     * @returns A fully-formed `ITool` instance whose `execute` method runs the pipeline.
     *
     * @example
     * ```ts
     * const tool = builder.build(
     *   'fetch_and_summarise',
     *   'Fetch a URL then return a one-paragraph summary.',
     *   { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
     *   spec,
     * );
     * ```
     */
    build(name: string, description: string, inputSchema: JSONSchemaObject, spec: ComposableToolSpec): ITool;
    /**
     * Validate a {@link ComposableToolSpec} before building.
     *
     * Performs structural checks only — it does not verify that the referenced tool
     * names are actually registered in any registry. Use this method to give early,
     * actionable feedback before attempting to {@link build} a tool.
     *
     * Checks performed:
     * 1. `spec.steps` must be a non-empty array.
     * 2. Every step must have a non-empty `tool` string.
     *
     * @param spec - The spec to validate.
     * @returns `{ valid: true }` when the spec passes all checks, or
     *   `{ valid: false, errors: string[] }` with one message per failing check.
     *
     * @example
     * ```ts
     * const result = builder.validate(spec);
     * if (!result.valid) {
     *   console.error('Invalid spec:', result.errors);
     * }
     * ```
     */
    validate(spec: ComposableToolSpec): {
        valid: boolean;
        errors?: string[];
    };
}
//# sourceMappingURL=ComposableToolBuilder.d.ts.map