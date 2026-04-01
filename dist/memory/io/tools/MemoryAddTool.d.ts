/**
 * @fileoverview MemoryAddTool — lets an agent store a new memory trace.
 *
 * The agent calls this tool to remember important facts, decisions, or
 * observations. Each invocation inserts a fresh row into `memory_traces`
 * with strength 1.0 (full encoding strength at creation time).
 *
 * ID format: `mt_<timestamp>_<counter>` — monotonically increasing within a
 * process, collision-safe across typical agent interaction rates.
 *
 * @module memory/tools/MemoryAddTool
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
/**
 * Input arguments for {@link MemoryAddTool}.
 *
 * @property content - The text content of the memory to store.
 * @property type    - Tulving memory type (episodic, semantic, procedural, prospective, relational). Defaults to 'episodic'.
 * @property scope   - Visibility scope (thread, user, persona, organization). Defaults to 'user'.
 * @property tags    - Optional array of free-form tag strings for filtering.
 */
export interface MemoryAddInput extends Record<string, any> {
    content: string;
    type?: string;
    scope?: string;
    tags?: string[];
}
/**
 * Output returned by {@link MemoryAddTool} on success.
 *
 * @property traceId - The unique ID of the newly stored memory trace.
 */
export interface MemoryAddOutput {
    traceId: string;
}
/**
 * ITool implementation that stores a new memory trace in the agent's
 * SQLite brain database.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryAddTool(brain);
 * const result = await tool.execute(
 *   { content: 'User prefers dark mode.', tags: ['preference', 'ui'] },
 *   context,
 * );
 * // result.output.traceId → 'mt_1711234567890_0'
 * ```
 */
export declare class MemoryAddTool implements ITool<MemoryAddInput, MemoryAddOutput> {
    private readonly brain;
    /** Globally unique tool identifier. */
    readonly id = "memory-add-v1";
    /** LLM-facing tool name (snake_case, as the LLM will call it). */
    readonly name = "memory_add";
    /** Human-readable display name for UIs and logs. */
    readonly displayName = "Add Memory";
    /**
     * Description shown to the LLM when deciding which tool to invoke.
     * Must be comprehensive enough for the model to understand when to call this.
     */
    readonly description = "Store a new memory trace. The agent calls this to remember important facts, decisions, or observations.";
    /** Logical category for discovery and grouping. */
    readonly category = "memory";
    /**
     * This tool writes to the database.
     * Callers may request confirmation before execution when `hasSideEffects = true`.
     */
    readonly hasSideEffects = true;
    /**
     * JSON schema for input validation and LLM tool-call construction.
     * All optional fields default gracefully inside `execute()`.
     */
    readonly inputSchema: JSONSchemaObject;
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain: SqliteBrain);
    /**
     * Insert a new memory trace row into `memory_traces`.
     *
     * Defaults applied when optional fields are absent:
     * - `type`  → `'episodic'`
     * - `scope` → `'user'`
     * - `tags`  → `[]`
     *
     * The trace is created with `strength = 1.0` (maximum encoding strength)
     * and `deleted = 0` (active). No embedding is computed here — the background
     * EmbeddingEncoder will embed it asynchronously.
     *
     * @param args    - Memory add input (content, optional type/scope/tags).
     * @param context - Tool execution context used to resolve the scope ID.
     * @returns `{ traceId }` on success, or an error result.
     */
    execute(args: MemoryAddInput, context: ToolExecutionContext): Promise<ToolExecutionResult<MemoryAddOutput>>;
}
//# sourceMappingURL=MemoryAddTool.d.ts.map