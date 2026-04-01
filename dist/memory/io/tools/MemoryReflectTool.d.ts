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
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { ConsolidationLoop } from '../../pipeline/consolidation/ConsolidationLoop.js';
import type { ConsolidationResult } from '../../io/facade/types.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
/**
 * Input arguments for {@link MemoryReflectTool}.
 *
 * @property topic - Optional hint for the consolidation run. Currently reserved
 *                   for future topic-scoped consolidation; ignored at runtime.
 */
export interface MemoryReflectInput extends Record<string, any> {
    topic?: string;
}
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
export declare class MemoryReflectTool implements ITool<MemoryReflectInput, ConsolidationResult> {
    private readonly brain;
    private readonly consolidation;
    /** Globally unique tool identifier. */
    readonly id = "memory-reflect-v1";
    /** LLM-facing tool name. */
    readonly name = "memory_reflect";
    /** Human-readable display name. */
    readonly displayName = "Reflect on Memory";
    /**
     * Description shown to the LLM. The consolidation steps are described
     * explicitly so the model understands what "reflect" means operationally.
     */
    readonly description: string;
    /** Logical category for discovery and grouping. */
    readonly category = "memory";
    /**
     * Consolidation writes to the database (pruning, merging, inserting insights).
     * Mark as having side effects so callers may request confirmation if needed.
     */
    readonly hasSideEffects = true;
    /** JSON schema for input validation and LLM tool-call construction. */
    readonly inputSchema: JSONSchemaObject;
    /**
     * @param brain         - The agent's shared SQLite brain database connection.
     *                        Accepted for symmetry with other memory tools and for
     *                        future direct consolidation calls.
     * @param consolidation - The {@link ConsolidationLoop} instance to invoke.
     */
    constructor(brain: SqliteBrain, consolidation: ConsolidationLoop);
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
    execute(_args: MemoryReflectInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<ConsolidationResult>>;
}
//# sourceMappingURL=MemoryReflectTool.d.ts.map