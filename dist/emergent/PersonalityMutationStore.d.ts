/**
 * @fileoverview SQLite persistence for personality mutations with
 * Ebbinghaus-style strength decay.
 *
 * Mutations persist across sessions and gradually fade toward baseline
 * unless reinforced by repeated adaptation. The ConsolidationLoop calls
 * {@link PersonalityMutationStore.decayAll} each cycle to reduce mutation
 * strengths; mutations whose strength drops below the 0.1 threshold are
 * pruned automatically.
 *
 * Uses the same {@link IStorageAdapter} interface as EmergentToolRegistry,
 * keeping storage concerns decoupled from specific SQLite drivers.
 *
 * @module @framers/agentos/emergent/PersonalityMutationStore
 */
import type { IStorageAdapter } from './EmergentToolRegistry.js';
/**
 * A single persisted personality mutation record.
 *
 * Represents a specific HEXACO trait adjustment made by the agent, along with
 * its current strength (which decays over time) and the reasoning that
 * motivated the change.
 */
export interface PersonalityMutation {
    /** Unique mutation identifier (format: `pm_<timestamp>_<random>`). */
    id: string;
    /** The agent that made this mutation. */
    agentId: string;
    /** The HEXACO trait that was mutated (e.g., `'openness'`, `'conscientiousness'`). */
    trait: string;
    /** The signed delta applied to the trait value. Positive = increase, negative = decrease. */
    delta: number;
    /** Free-text reasoning explaining why the agent chose to mutate this trait. */
    reasoning: string;
    /** The trait value before this mutation was applied. */
    baselineValue: number;
    /** The trait value after this mutation was applied. */
    mutatedValue: number;
    /**
     * Current strength of this mutation in the range (0, 1].
     *
     * Starts at 1.0 when recorded and decays each consolidation cycle.
     * When strength drops to 0.1 or below, the mutation is pruned.
     */
    strength: number;
    /** Unix epoch millisecond timestamp of when this mutation was recorded. */
    createdAt: number;
}
/**
 * Input parameters for recording a new personality mutation.
 *
 * The `strength` and `createdAt` fields are set automatically by the store
 * (1.0 and `Date.now()` respectively).
 */
export interface RecordMutationInput {
    /** The agent making the mutation. */
    agentId: string;
    /** The HEXACO trait being mutated. */
    trait: string;
    /** The signed delta to apply. */
    delta: number;
    /** Free-text reasoning for the mutation. */
    reasoning: string;
    /** The trait value before mutation. */
    baselineValue: number;
    /** The trait value after mutation. */
    mutatedValue: number;
}
/**
 * Result of a decay cycle, reporting how many mutations were weakened
 * and how many were pruned (deleted) for falling below the threshold.
 */
export interface DecayResult {
    /** Number of mutations whose strength was reduced but still above threshold. */
    decayed: number;
    /** Number of mutations deleted for falling at or below the 0.1 threshold. */
    pruned: number;
}
/**
 * SQLite-backed persistence layer for personality mutations with decay.
 *
 * Follows the same `ensureSchema()` pattern as {@link EmergentToolRegistry}:
 * a cached promise guards against concurrent DDL execution, and all DML
 * methods await schema readiness before proceeding.
 *
 * @example
 * ```ts
 * const store = new PersonalityMutationStore(sqliteAdapter);
 *
 * // Record a mutation
 * const id = await store.record({
 *   agentId: 'agent-42',
 *   trait: 'openness',
 *   delta: 0.1,
 *   reasoning: 'User prefers creative responses',
 *   baselineValue: 0.7,
 *   mutatedValue: 0.8,
 * });
 *
 * // Get strength-weighted effective deltas
 * const deltas = await store.getEffectiveDeltas('agent-42');
 * // => { openness: 0.1 }  (strength is 1.0 initially)
 *
 * // Decay all mutations by 5%
 * const { decayed, pruned } = await store.decayAll(0.05);
 * ```
 */
export declare class PersonalityMutationStore {
    /** The underlying SQLite storage adapter. */
    private readonly db;
    /**
     * Cached schema initialization promise.
     * Ensures DDL runs exactly once, even under concurrent access.
     */
    private schemaReady;
    /**
     * Create a new PersonalityMutationStore.
     *
     * @param db - A storage adapter implementing the {@link IStorageAdapter}
     *   interface. The same adapter used by EmergentToolRegistry can be reused.
     */
    constructor(db: IStorageAdapter);
    /**
     * Idempotent schema initialization.
     *
     * Creates the `personality_mutations` table and its agent/trait index if
     * they don't already exist. Uses the adapter's `exec()` method when
     * available (for multi-statement DDL), falling back to individual `run()`
     * calls for adapters that don't support it.
     *
     * @returns A promise that resolves when the schema is ready.
     */
    private ensureSchema;
    /**
     * Record a new personality mutation.
     *
     * Inserts a mutation record with initial strength of 1.0 and the current
     * timestamp. The mutation ID is generated deterministically from the
     * current time and a random suffix.
     *
     * @param input - The mutation parameters (agent, trait, delta, reasoning, values).
     * @returns The generated mutation ID.
     */
    record(input: RecordMutationInput): Promise<string>;
    /**
     * Load all active mutations for a given agent.
     *
     * Returns only mutations whose strength is above the 0.1 pruning threshold,
     * ordered by creation time (newest first).
     *
     * @param agentId - The agent whose mutations to load.
     * @returns An array of {@link PersonalityMutation} records.
     */
    loadForAgent(agentId: string): Promise<PersonalityMutation[]>;
    /**
     * Compute the effective (strength-weighted) delta for each trait.
     *
     * For each active mutation, multiplies the raw delta by the mutation's
     * current strength, then sums per trait. This gives a realistic picture
     * of how much each trait has drifted from baseline, accounting for decay.
     *
     * @param agentId - The agent whose effective deltas to compute.
     * @returns A map of trait name to effective delta (sum of `delta * strength`).
     */
    getEffectiveDeltas(agentId: string): Promise<Record<string, number>>;
    /**
     * Decay all active mutations by the given rate and prune expired ones.
     *
     * For each mutation with strength above 0.1:
     * - Subtracts `rate` from its strength.
     * - If the new strength is at or below 0.1, the mutation is deleted (pruned).
     * - Otherwise, the strength is updated in place.
     *
     * This implements Ebbinghaus-style forgetting: mutations that aren't
     * reinforced by repeated adaptation gradually fade away.
     *
     * @param rate - The amount to subtract from each mutation's strength.
     *   Typically 0.05 (the default from SelfImprovementConfig).
     * @returns A {@link DecayResult} with counts of decayed and pruned mutations.
     */
    decayAll(rate: number): Promise<DecayResult>;
}
//# sourceMappingURL=PersonalityMutationStore.d.ts.map