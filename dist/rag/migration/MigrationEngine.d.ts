/**
 * @fileoverview Universal streaming migration engine between vector store backends.
 * @module rag/migration/MigrationEngine
 *
 * Streams data in configurable batches between any pair of supported backends
 * (SQLite, Postgres, Qdrant). Never loads the entire dataset into memory.
 *
 * Usage:
 * ```typescript
 * import { MigrationEngine } from '@framers/agentos';
 *
 * await MigrationEngine.migrate({
 *   from: { type: 'sqlite', path: './brain.sqlite' },
 *   to: { type: 'postgres', connectionString: 'postgresql://...' },
 *   batchSize: 1000,
 *   onProgress: (done, total, table) => console.log(`${table}: ${done}/${total}`),
 * });
 * ```
 */
import type { MigrationOptions, MigrationResult } from './types.js';
export declare class MigrationEngine {
    /**
     * Migrate data between any two backends.
     *
     * The engine:
     * 1. Connects to source and lists available tables.
     * 2. For each table, reads rows in streaming batches.
     * 3. Creates the table in the target (if it doesn't exist).
     * 4. Writes each batch to the target.
     * 5. Reports progress after each batch.
     *
     * @param options - Source, target, batch size, and progress callback.
     * @returns Migration result with counts, duration, and any errors.
     */
    static migrate(options: MigrationOptions): Promise<MigrationResult>;
    /**
     * Create a source adapter for the given backend type.
     * Uses dynamic imports so unused adapters don't bloat the bundle.
     */
    private static _createSource;
    /**
     * Create a target adapter for the given backend type.
     * Uses dynamic imports so unused adapters don't bloat the bundle.
     */
    private static _createTarget;
}
//# sourceMappingURL=MigrationEngine.d.ts.map