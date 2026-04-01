/**
 * @fileoverview MemoryDeleteTool — lets an agent soft-delete a memory trace.
 *
 * Deletion is always a soft-delete: the row in `memory_traces` is kept intact
 * but its `deleted` flag is set to `1`. This preserves the audit trail and
 * allows the consolidation engine to later log or compact the removal.
 *
 * The optional `reason` argument is currently captured in the tool contract
 * but not stored in the database; it is reserved for a future `deleted_reason`
 * column when schema migration tooling is in place.
 *
 * @module memory/tools/MemoryDeleteTool
 */
// ---------------------------------------------------------------------------
// MemoryDeleteTool
// ---------------------------------------------------------------------------
/**
 * ITool implementation that soft-deletes a memory trace from the agent's
 * SQLite brain database.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryDeleteTool(brain);
 * const result = await tool.execute(
 *   { traceId: 'mt_1711234567890_0', reason: 'Information is outdated.' },
 *   context,
 * );
 * // result.output.deleted → true
 * ```
 */
export class MemoryDeleteTool {
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain) {
        this.brain = brain;
        /** Globally unique tool identifier. */
        this.id = 'memory-delete-v1';
        /** LLM-facing tool name. */
        this.name = 'memory_delete';
        /** Human-readable display name. */
        this.displayName = 'Delete Memory';
        /** LLM-facing description. */
        this.description = 'Soft-delete a memory trace by ID. The trace is not physically removed — ' +
            'it is flagged as deleted and excluded from future searches and consolidation. ' +
            'Use when a fact is outdated, incorrect, or no longer relevant.';
        /** Logical category for discovery and grouping. */
        this.category = 'memory';
        /** This tool writes to the database. */
        this.hasSideEffects = true;
        /** JSON schema for input validation and LLM tool-call construction. */
        this.inputSchema = {
            type: 'object',
            properties: {
                traceId: {
                    type: 'string',
                    description: 'The unique ID of the memory trace to delete.',
                },
                reason: {
                    type: 'string',
                    description: 'Optional human-readable reason for deleting this memory.',
                },
            },
            required: ['traceId'],
        };
    }
    // ---------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------
    /**
     * Set `deleted = 1` on the memory trace matching `traceId`.
     *
     * The WHERE clause filters to `deleted = 0` so that attempting to
     * delete an already-deleted trace returns `{ deleted: false }` rather
     * than silently succeeding — this gives callers accurate feedback.
     *
     * @param args     - Delete input (traceId, optional reason).
     * @param _context - Tool execution context (not used by this tool).
     * @returns `{ deleted }` status, or an error result.
     */
    async execute(args, _context) {
        try {
            const info = await this.brain.run(`UPDATE memory_traces SET deleted = 1 WHERE id = ? AND deleted = 0`, [args.traceId]);
            return { success: true, output: { deleted: info.changes > 0 } };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=MemoryDeleteTool.js.map