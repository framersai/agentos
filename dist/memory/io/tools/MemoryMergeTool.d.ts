/**
 * @fileoverview MemoryMergeTool — lets an agent merge multiple memory traces
 * into a single, consolidated trace.
 *
 * The merge process:
 * 1. Load all specified traces from the database.
 * 2. Select the survivor — the trace with the highest `retrieval_count`
 *    (most-frequently accessed, i.e. most valuable). Ties broken by taking
 *    the first trace in the provided `traceIds` array.
 * 3. Determine merged content — use `mergedContent` if the agent supplied it,
 *    otherwise concatenate all trace contents with ` | ` as separator.
 * 4. Update the survivor's content, clear its embedding (stale after merge),
 *    and union the tags from all merged traces (deduplicated).
 * 5. Soft-delete all non-survivor traces.
 *
 * @module memory/tools/MemoryMergeTool
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
/**
 * Input arguments for {@link MemoryMergeTool}.
 *
 * @property traceIds      - Array of trace IDs to merge. Must contain at least 2 IDs.
 * @property mergedContent - Optional pre-composed merged content. If omitted, the
 *                           contents of all traces are concatenated with ` | `.
 */
export interface MemoryMergeInput extends Record<string, any> {
    traceIds: string[];
    mergedContent?: string;
}
/**
 * Output returned by {@link MemoryMergeTool} on success.
 *
 * @property survivorId  - The ID of the trace that survived the merge.
 * @property deletedIds  - IDs of all traces that were soft-deleted.
 */
export interface MemoryMergeOutput {
    survivorId: string;
    deletedIds: string[];
}
/**
 * ITool implementation that merges multiple memory traces into one.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryMergeTool(brain);
 * const result = await tool.execute(
 *   {
 *     traceIds: ['mt_1_0', 'mt_2_0', 'mt_3_0'],
 *     mergedContent: 'Consolidated insight from three related observations.',
 *   },
 *   context,
 * );
 * // result.output → { survivorId: 'mt_1_0', deletedIds: ['mt_2_0', 'mt_3_0'] }
 * ```
 */
export declare class MemoryMergeTool implements ITool<MemoryMergeInput, MemoryMergeOutput> {
    private readonly brain;
    /** Globally unique tool identifier. */
    readonly id = "memory-merge-v1";
    /** LLM-facing tool name. */
    readonly name = "memory_merge";
    /** Human-readable display name. */
    readonly displayName = "Merge Memories";
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
     * Merge the specified traces into one survivor.
     *
     * Steps:
     * 1. Validate that at least 2 trace IDs were supplied.
     * 2. Load all matching, non-deleted traces from the database.
     * 3. Pick survivor by highest `retrieval_count`; fallback to first found.
     * 4. Compute merged content (provided or concatenated).
     * 5. Union all tags, deduplicate.
     * 6. Update survivor: new content, cleared embedding, unioned tags.
     * 7. Soft-delete all non-survivor traces.
     *
     * @param args     - Merge input (traceIds, optional mergedContent).
     * @param _context - Tool execution context (not used by this tool).
     * @returns `{ survivorId, deletedIds }` on success, or an error result.
     */
    execute(args: MemoryMergeInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<MemoryMergeOutput>>;
}
//# sourceMappingURL=MemoryMergeTool.d.ts.map