/**
 * @fileoverview MemoryUpdateTool — lets an agent update an existing memory trace.
 *
 * Supports partial updates: the agent may change just the content, just the
 * tags, or both. When the content is changed, the stored embedding is cleared
 * so the background EmbeddingEncoder will re-embed the trace asynchronously
 * on the next pass — preventing stale vector data from contaminating semantic
 * search results.
 *
 * @module memory/tools/MemoryUpdateTool
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
/**
 * Input arguments for {@link MemoryUpdateTool}.
 *
 * At least one of `content` or `tags` must be provided alongside `traceId`
 * for an update to have any effect.
 *
 * @property traceId - The ID of the memory trace to update (e.g. `mt_1234_0`).
 * @property content - New text content. When changed, the embedding is cleared.
 * @property tags    - Replacement tag array (overwrites existing tags entirely).
 */
export interface MemoryUpdateInput extends Record<string, any> {
    traceId: string;
    content?: string;
    tags?: string[];
}
/**
 * Output returned by {@link MemoryUpdateTool} on success.
 *
 * @property updated - `true` if a matching, non-deleted trace was found and updated.
 *                     `false` if the trace was not found or was already soft-deleted.
 */
export interface MemoryUpdateOutput {
    updated: boolean;
}
/**
 * ITool implementation that applies partial updates to an existing memory
 * trace stored in the agent's SQLite brain database.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryUpdateTool(brain);
 * const result = await tool.execute(
 *   { traceId: 'mt_1711234567890_0', content: 'Updated content here.' },
 *   context,
 * );
 * // result.output.updated → true
 * ```
 */
export declare class MemoryUpdateTool implements ITool<MemoryUpdateInput, MemoryUpdateOutput> {
    private readonly brain;
    /** Globally unique tool identifier. */
    readonly id = "memory-update-v1";
    /** LLM-facing tool name. */
    readonly name = "memory_update";
    /** Human-readable display name. */
    readonly displayName = "Update Memory";
    /** LLM-facing description. */
    readonly description: string;
    /** Logical category for discovery and grouping. */
    readonly category = "memory";
    /** This tool writes to the database. */
    readonly hasSideEffects = true;
    /** JSON schema for input validation and LLM tool-call construction. */
    readonly inputSchema: JSONSchemaObject;
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain: SqliteBrain);
    /**
     * Update a memory trace identified by `traceId`.
     *
     * The method builds a dynamic SET clause based on which optional fields
     * are provided:
     * - `content` provided → set `content = ?`, also set `embedding = NULL`
     *   to signal that the cached vector is stale.
     * - `tags` provided → serialise array as JSON and set `tags = ?`.
     *
     * If neither `content` nor `tags` is specified, the method returns
     * `{ updated: false }` immediately without touching the database.
     *
     * A trace that does not exist or has `deleted = 1` returns `{ updated: false }`.
     *
     * @param args     - Update input (traceId, optional content/tags).
     * @param _context - Tool execution context (not used by this tool).
     * @returns `{ updated }` status, or an error result.
     */
    execute(args: MemoryUpdateInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<MemoryUpdateOutput>>;
}
//# sourceMappingURL=MemoryUpdateTool.d.ts.map