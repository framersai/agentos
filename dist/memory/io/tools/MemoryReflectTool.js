/**
 * @fileoverview MemoryReflectTool — lets an agent trigger offline memory
 * consolidation on demand.
 *
 * Consolidation is the analogue of slow-wave-sleep memory processing:
 * - **Prune** — soft-delete traces whose Ebbinghaus strength has decayed below threshold.
 * - **Merge** — deduplicate near-identical traces (embedding similarity or hash).
 * - **Strengthen** — record Hebbian co-activation edges from retrieval feedback.
 * - **Derive** — synthesise higher-level insight traces from memory clusters (LLM-backed).
 * - **Compact** — promote old, high-retrieval episodic traces to semantic type.
 * - **Re-index** — rebuild FTS5 index and log the run to `consolidation_log`.
 *
 * The optional `topic` argument is accepted at the contract level but is not
 * yet threaded into the ConsolidationLoop (which currently runs globally).
 * It is reserved for a future topic-scoped consolidation mode.
 *
 * @module memory/tools/MemoryReflectTool
 */
// ---------------------------------------------------------------------------
// MemoryReflectTool
// ---------------------------------------------------------------------------
/**
 * ITool implementation that triggers one full memory consolidation cycle via
 * {@link ConsolidationLoop.run()}.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryReflectTool(brain, consolidationLoop);
 * const result = await tool.execute({}, context);
 * // result.output → { pruned: 3, merged: 1, derived: 0, compacted: 2, durationMs: 42 }
 * ```
 */
export class MemoryReflectTool {
    /**
     * @param brain         - The agent's shared SQLite brain database connection.
     *                        Accepted for symmetry with other memory tools and for
     *                        future direct consolidation calls.
     * @param consolidation - The {@link ConsolidationLoop} instance to invoke.
     */
    constructor(brain, consolidation) {
        this.brain = brain;
        this.consolidation = consolidation;
        /** Globally unique tool identifier. */
        this.id = 'memory-reflect-v1';
        /** LLM-facing tool name. */
        this.name = 'memory_reflect';
        /** Human-readable display name. */
        this.displayName = 'Reflect on Memory';
        /**
         * Description shown to the LLM. The consolidation steps are described
         * explicitly so the model understands what "reflect" means operationally.
         */
        this.description = 'Trigger memory consolidation — prune weak memories, merge duplicates, derive insights from patterns. ' +
            'This runs an offline slow-wave-sleep analogue: decayed traces are pruned, near-identical traces are ' +
            'merged, Hebbian co-activation edges are recorded, insights are derived from clusters, and old ' +
            'high-retrieval episodic traces are promoted to semantic type. Returns consolidation statistics.';
        /** Logical category for discovery and grouping. */
        this.category = 'memory';
        /**
         * Consolidation writes to the database (pruning, merging, inserting insights).
         * Mark as having side effects so callers may request confirmation if needed.
         */
        this.hasSideEffects = true;
        /** JSON schema for input validation and LLM tool-call construction. */
        this.inputSchema = {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'Optional topic hint for the consolidation run. Reserved for future topic-scoped consolidation.',
                },
            },
        };
    }
    // ---------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------
    /**
     * Run one full consolidation cycle and return the statistics.
     *
     * If a consolidation cycle is already in progress (mutex guard in
     * {@link ConsolidationLoop}), `run()` returns immediately with zero counts —
     * this is surfaced as a successful result with all-zero statistics.
     *
     * @param _args    - Reflect input (optional topic hint, currently unused).
     * @param _context - Tool execution context (not used by this tool).
     * @returns {@link ConsolidationResult} on success, or an error result.
     */
    async execute(_args, _context) {
        try {
            const result = await this.consolidation.run();
            return { success: true, output: result };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=MemoryReflectTool.js.map