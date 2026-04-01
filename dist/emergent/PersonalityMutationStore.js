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
// ============================================================================
// STORE
// ============================================================================
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
export class PersonalityMutationStore {
    /**
     * Create a new PersonalityMutationStore.
     *
     * @param db - A storage adapter implementing the {@link IStorageAdapter}
     *   interface. The same adapter used by EmergentToolRegistry can be reused.
     */
    constructor(db) {
        /**
         * Cached schema initialization promise.
         * Ensures DDL runs exactly once, even under concurrent access.
         */
        this.schemaReady = null;
        this.db = db;
    }
    // --------------------------------------------------------------------------
    // SCHEMA
    // --------------------------------------------------------------------------
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
    async ensureSchema() {
        if (!this.schemaReady) {
            this.schemaReady = (async () => {
                const ddl = `
          CREATE TABLE IF NOT EXISTS personality_mutations (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            trait TEXT NOT NULL,
            delta REAL NOT NULL,
            reasoning TEXT NOT NULL,
            baseline_value REAL NOT NULL,
            mutated_value REAL NOT NULL,
            strength REAL NOT NULL DEFAULT 1.0,
            created_at BIGINT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_personality_mutations_agent
            ON personality_mutations(agent_id, trait);
        `;
                if (this.db.exec) {
                    await this.db.exec(ddl);
                }
                else {
                    // Split on semicolons and execute each non-empty statement individually.
                    for (const stmt of ddl.split(';').filter((s) => s.trim())) {
                        await this.db.run(stmt);
                    }
                }
            })();
        }
        return this.schemaReady;
    }
    // --------------------------------------------------------------------------
    // RECORD
    // --------------------------------------------------------------------------
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
    async record(input) {
        await this.ensureSchema();
        const id = `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await this.db.run(`INSERT INTO personality_mutations
        (id, agent_id, trait, delta, reasoning, baseline_value, mutated_value, strength, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, ?)`, [
            id,
            input.agentId,
            input.trait,
            input.delta,
            input.reasoning,
            input.baselineValue,
            input.mutatedValue,
            Date.now(),
        ]);
        return id;
    }
    // --------------------------------------------------------------------------
    // LOAD
    // --------------------------------------------------------------------------
    /**
     * Load all active mutations for a given agent.
     *
     * Returns only mutations whose strength is above the 0.1 pruning threshold,
     * ordered by creation time (newest first).
     *
     * @param agentId - The agent whose mutations to load.
     * @returns An array of {@link PersonalityMutation} records.
     */
    async loadForAgent(agentId) {
        await this.ensureSchema();
        const rows = await this.db.all('SELECT * FROM personality_mutations WHERE agent_id = ? AND strength > 0.1 ORDER BY created_at DESC', [agentId]);
        return rows.map((r) => ({
            id: r.id,
            agentId: r.agent_id,
            trait: r.trait,
            delta: r.delta,
            reasoning: r.reasoning,
            baselineValue: r.baseline_value,
            mutatedValue: r.mutated_value,
            strength: r.strength,
            createdAt: r.created_at,
        }));
    }
    // --------------------------------------------------------------------------
    // EFFECTIVE DELTAS
    // --------------------------------------------------------------------------
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
    async getEffectiveDeltas(agentId) {
        const mutations = await this.loadForAgent(agentId);
        const deltas = {};
        for (const m of mutations) {
            deltas[m.trait] = (deltas[m.trait] ?? 0) + m.delta * m.strength;
        }
        return deltas;
    }
    // --------------------------------------------------------------------------
    // DECAY
    // --------------------------------------------------------------------------
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
    async decayAll(rate) {
        await this.ensureSchema();
        const all = await this.db.all('SELECT id, strength FROM personality_mutations WHERE strength > 0.1', []);
        let decayed = 0;
        let pruned = 0;
        for (const row of all) {
            const newStrength = row.strength - rate;
            if (newStrength <= 0.1) {
                await this.db.run('DELETE FROM personality_mutations WHERE id = ?', [row.id]);
                pruned++;
            }
            else {
                await this.db.run('UPDATE personality_mutations SET strength = ? WHERE id = ?', [newStrength, row.id]);
                decayed++;
            }
        }
        return { decayed, pruned };
    }
}
//# sourceMappingURL=PersonalityMutationStore.js.map