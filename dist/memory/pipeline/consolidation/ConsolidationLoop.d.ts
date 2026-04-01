/**
 * @fileoverview ConsolidationLoop — self-improving background memory maintenance.
 *
 * Runs 6 ordered consolidation steps that mirror the brain's offline
 * slow-wave-sleep consolidation process:
 *
 * 1. **Prune** — soft-delete traces whose Ebbinghaus strength has decayed
 *    below the configurable `pruneThreshold`.
 * 2. **Merge** — deduplicate near-identical traces. Uses embedding cosine
 *    similarity when available, falls back to exact content-hash comparison.
 * 3. **Strengthen** — read retrieval-feedback co-usage signals and record
 *    Hebbian co-activation edges in the memory graph.
 * 4. **Derive** — (requires LLM) detect clusters of related memories and
 *    synthesise higher-level insight traces from them.
 * 5. **Compact** — promote old, high-retrieval episodic traces to semantic
 *    type (lightweight episodic-to-semantic migration).
 * 6. **Re-index** — rebuild the FTS5 index and log the consolidation run
 *    to the `consolidation_log` table.
 *
 * A simple boolean mutex prevents concurrent runs. If `run()` is called
 * while a cycle is already in progress, it returns immediately with zero
 * counts.
 *
 * @module agentos/memory/consolidation/ConsolidationLoop
 */
import type { ConsolidationResult, ExtendedConsolidationConfig } from '../../io/facade/types.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
import type { IMemoryGraph } from '../../retrieval/graph/IMemoryGraph.js';
import type { PersonalityMutationStore } from '../../../emergent/PersonalityMutationStore.js';
/**
 * Self-improving background consolidation loop with 6 ordered steps:
 * prune, merge, strengthen, derive, compact, re-index.
 *
 * All database operations use the async `StorageAdapter` API through
 * the shared {@link SqliteBrain} connection. The `run()` method is async
 * to accommodate both the database calls and the LLM-backed derive step.
 */
export declare class ConsolidationLoop {
    private readonly brain;
    private readonly memoryGraph;
    private readonly options?;
    /**
     * Simple mutex flag. When `true`, a consolidation cycle is in progress
     * and any concurrent `run()` call returns immediately with zero counts.
     */
    private _running;
    /**
     * @param brain       - The agent's SQLite brain database connection.
     * @param memoryGraph - The memory association graph for co-activation and clustering.
     * @param options     - Optional LLM invoker, embedding function, and
     *   personality mutation store for derive, merge, and decay steps respectively.
     */
    constructor(brain: SqliteBrain, memoryGraph: IMemoryGraph, options?: {
        /** LLM function for deriving insights from memory clusters. */
        llmInvoker?: (prompt: string) => Promise<string>;
        /** Embedding function for computing trace similarity. */
        embedFn?: (texts: string[]) => Promise<number[][]>;
        /**
         * Optional personality mutation store for Ebbinghaus-style decay.
         *
         * When provided, each consolidation cycle decays all active personality
         * mutations and prunes those whose strength falls below the threshold.
         */
        personalityMutationStore?: PersonalityMutationStore;
        /**
         * Decay rate subtracted from each personality mutation's strength per cycle.
         * Mutations at or below 0.1 after decay are pruned.
         * @default 0.05
         */
        personalityDecayRate?: number;
    } | undefined);
    /**
     * Run one full consolidation cycle.
     *
     * The mutex prevents concurrent runs — if `_running` is already true,
     * returns immediately with a zero-count result.
     *
     * @param config - Optional overrides for consolidation thresholds.
     * @returns Consolidation statistics (pruned, merged, derived, compacted, durationMs).
     */
    run(config?: Partial<ExtendedConsolidationConfig>): Promise<ConsolidationResult>;
    /**
     * Whether consolidation is currently running.
     * Useful for callers to check before scheduling a new run.
     */
    get isRunning(): boolean;
    /**
     * Query all non-deleted traces and soft-delete those whose current
     * Ebbinghaus strength has decayed below `threshold`.
     *
     * @param threshold - Minimum strength to survive pruning.
     * @returns Number of traces pruned.
     */
    private _prune;
    /**
     * Find and merge trace pairs with very similar content.
     *
     * When an embedding function is available, cosine similarity is used.
     * Otherwise falls back to exact content hash comparison (SHA-256).
     *
     * Merge semantics:
     * - The trace with more retrievals survives; the other is soft-deleted.
     * - Tags are unioned (JSON arrays merged, deduplicated).
     * - Emotional vectors are averaged.
     * - The survivor takes the maximum strength of the pair.
     *
     * @param threshold - Cosine similarity above which two traces are merged.
     * @returns Number of traces merged (deleted).
     */
    private _merge;
    /**
     * Merge two traces: keep the one with more retrievals, soft-delete the other.
     * Union tags, average emotions, take max strength.
     *
     * @param a          - First trace row.
     * @param b          - Second trace row.
     * @param deletedIds - Set tracking which IDs have been soft-deleted this cycle.
     */
    private _mergeTracePair;
    /**
     * Query the `retrieval_feedback` table for traces that were co-used
     * (same query string, both with signal = 'used') and record Hebbian
     * co-activation edges in the memory graph.
     *
     * @returns Number of co-activation pairs strengthened.
     */
    private _strengthen;
    /**
     * Detect memory clusters and use the LLM to derive higher-level insights.
     *
     * Skips entirely if no `llmInvoker` was provided. For each of the top-N
     * clusters (by size), collects member trace contents and sends them to the
     * LLM with a concise instruction prompt.
     *
     * @param minClusterSize - Minimum cluster size for `detectClusters()`.
     * @param maxDerived     - Maximum number of insights to create this cycle.
     * @returns Number of insight traces created.
     */
    private _derive;
    /**
     * Find episodic traces older than 7 days with high retrieval count and
     * promote them to semantic type.
     *
     * This is a lightweight version of compaction — full LLM-based summarization
     * via the CompactionEngine is deferred. For now, the trace type is simply
     * changed to 'semantic' and the timestamp is logged.
     *
     * @returns Number of traces compacted.
     */
    private _compact;
    /**
     * Decay all active personality mutations by the configured rate.
     *
     * Delegates to {@link PersonalityMutationStore.decayAll} when a store is
     * provided. Mutations whose strength drops at or below 0.1 are pruned.
     *
     * This step sits between compact and reindex to ensure personality decay
     * is captured in the same consolidation cycle as memory maintenance.
     *
     * @returns Number of personality mutations pruned (deleted), or 0 if no
     *   store is configured.
     */
    private _decayPersonality;
    /**
     * Rebuild the FTS5 index to reflect any content changes from the cycle,
     * and write a summary row to the `consolidation_log` table.
     *
     * @param pruned    - Number of traces pruned.
     * @param merged    - Number of traces merged.
     * @param derived   - Number of insights derived (includes strengthened edges).
     * @param compacted - Number of traces compacted.
     * @param durationMs - Total cycle duration in milliseconds.
     */
    private _reindex;
    /**
     * Convert a raw `TraceRow` into a minimal `MemoryTrace`-compatible shape
     * that `computeCurrentStrength()` can consume.
     *
     * Only the fields required by the Ebbinghaus formula are populated:
     * `encodingStrength`, `stability` (derived from strength as a proxy),
     * and `lastAccessedAt`.
     *
     * @param row - Raw SQLite row from `memory_traces`.
     * @returns A minimal MemoryTrace object.
     */
    private _rowToMinimalTrace;
    /**
     * Compute cosine similarity between two embedding vectors.
     *
     * @param a - First vector.
     * @param b - Second vector.
     * @returns Cosine similarity in [-1, 1].
     */
    private _cosineSimilarity;
    /**
     * Average two emotion objects by computing the mean of all shared numeric keys.
     *
     * @param a - First emotion record.
     * @param b - Second emotion record.
     * @returns Averaged emotion record.
     */
    private _averageEmotions;
}
//# sourceMappingURL=ConsolidationLoop.d.ts.map